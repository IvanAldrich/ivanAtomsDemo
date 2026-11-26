import { readFile } from "node:fs/promises";
import path from "node:path";
import { isContextFile } from "./file-kinds";
import {
  deriveHeuristicManifest,
  manifestSummary,
  moduleSignature,
  readManifest,
  resolveBudgets,
  resolveDep,
  type ModuleEntry,
  type ModuleManifest,
} from "./manifest";
import { isValidPath } from "./protocol";

export type ContextFile = {
  path: string;
  content: string;
  bytes: number;
  truncated?: boolean;
  index?: string;
};

export type ContextStub = {
  path: string;
  role: string;
  exports: string[];
};

export type IterationContextBundle = {
  manifest: ModuleManifest;
  requirements: string[];
  files: ContextFile[];
  stubs: ContextStub[];
  targetPaths: string[];
  manifestSummary: string;
  totalBytes: number;
  budgetKB: number;
};

export type BuildContextOptions = {
  manifest?: ModuleManifest | null;
  recentPaths?: string[];
  maxTargets?: number;
  budgetKB?: number;
};

const HISTORY_TURNS = 3;
const HISTORY_CHARS = 500;

const ROLE_PRIORITY: Record<string, number> = {
  "entry-html": 0,
  bootstrap: 1,
  input: 2,
  ui: 3,
  hud: 3,
  "game-loop": 4,
  renderer: 5,
  physics: 6,
  entities: 6,
  levels: 6,
  storage: 7,
  "local-cache": 7,
  styles: 8,
  server: 9,
};

function rolePriority(role: string): number {
  return ROLE_PRIORITY[role] ?? 6;
}

const UI_KEYWORDS =
  /(界面|页面|按钮|菜单|开始|暂停|点击|没响应|不工作|显示|布局|样式|分数|得分|生命|hud|ui|menu|button|click|start|pause|score|layout)/i;

const LAYOUT_RE =
  /(布局|样式|颜色|间距|对齐|响应式|挤|丑|style|css|layout|color|spacing)/i;

const ROLE_KEYWORDS: Array<{ test: RegExp; keywords: RegExp }> = [
  { test: /(ui|hud|menu|button)/i, keywords: UI_KEYWORDS },
  { test: /(bootstrap|main)/i, keywords: /(点击|开始|启动|初始化|没响应|不工作|bootstrap|main|init|start|click)/i },
  { test: /(game-loop|engine|logic)/i, keywords: /(游戏|主循环|引擎|开始|点击|没响应|不工作|卡顿|game|engine|loop|logic|start|click)/i },
  { test: /(storage|store|db|save)/i, keywords: /(保存|存档|持久化|存储|数据|save|storage|persist)/i },
  { test: /(input|keyboard|touch)/i, keywords: /(键盘|鼠标|触摸|输入|按键|点击|没响应|不工作|input|keyboard|touch|click)/i },
  { test: /(render|canvas|draw)/i, keywords: /(渲染|绘制|画面|画布|卡顿|不显示|canvas|render|draw)/i },
  { test: /(entit|player|enemy)/i, keywords: /(玩家|敌人|角色|实体|player|enemy|entity)/i },
  { test: /(level|map)/i, keywords: /(关卡|地图|level|map)/i },
  { test: /(audio|sound)/i, keywords: /(音效|声音|音乐|audio|sound|music)/i },
  { test: /(style|css)/i, keywords: /(样式|颜色|布局|间距|对齐|响应式|挤|丑|style|css|layout|color|spacing)/i },
  { test: /(route|api|server)/i, keywords: /(接口|路由|api|route|endpoint|后端)/i },
];

function mentionsPath(requirement: string, filePath: string): boolean {
  const lower = requirement.toLowerCase();
  const full = filePath.toLowerCase();
  const base = path.posix.basename(full);
  return lower.includes(full) || (base.length > 2 && lower.includes(base));
}

export function scoreModule(
  module: ModuleEntry,
  requirement: string,
  recentPaths: string[],
  manifest: ModuleManifest
): number {
  let score = 0;
  if (mentionsPath(requirement, module.path)) score += 10;
  if (recentPaths.includes(module.path)) score += 5;
  for (const rk of ROLE_KEYWORDS) {
    if (rk.test.test(module.role) && rk.keywords.test(requirement)) {
      score += 3;
      break;
    }
  }
  if (module.path === manifest.entry) {
    score += 2;
    if (UI_KEYWORDS.test(requirement)) score += 4;
  }
  return score;
}

function fallbackTargets(manifest: ModuleManifest, limit: number): ModuleEntry[] {
  const preferredRoles = ["ui", "game-loop", "bootstrap", "server", "view", "http-routes"];
  const out: ModuleEntry[] = [];
  const entry = manifest.modules.find((m) => m.path === manifest.entry);
  if (entry) out.push(entry);
  for (const role of preferredRoles) {
    for (const m of manifest.modules) {
      if (m.role === role && !out.includes(m)) out.push(m);
      if (out.length >= limit) return out;
    }
  }
  for (const m of manifest.modules) {
    if (!out.includes(m)) out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

export function pickTargets(
  manifest: ModuleManifest,
  requirement: string,
  recentPaths: string[],
  maxTargets = 3
): ModuleEntry[] {
  const ranked = manifest.modules
    .filter(
      (m) =>
        isContextFile(m.path) &&
        (!m.path.endsWith(".html") || m.path === manifest.entry)
    )
    .map((m) => ({ m, score: scoreModule(m, requirement, recentPaths, manifest) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        rolePriority(a.m.role) - rolePriority(b.m.role) ||
        a.m.path.localeCompare(b.m.path)
    );
  if (ranked.length === 0) {
    return fallbackTargets(manifest, maxTargets).filter(
      (m) => !m.path.endsWith(".html") || m.path === manifest.entry
    );
  }
  const selected = ranked.slice(0, maxTargets).map((x) => x.m);
  if (
    LAYOUT_RE.test(requirement) &&
    !selected.some((m) => /(style|css)/i.test(m.role))
  ) {
    const style = ranked.find((x) => /(style|css)/i.test(x.m.role));
    if (style) {
      let replaceIdx = selected.length - 1;
      for (let i = selected.length - 1; i >= 0; i--) {
        if (
          selected[i].path !== manifest.entry &&
          !/bootstrap/i.test(selected[i].role)
        ) {
          replaceIdx = i;
          break;
        }
      }
      selected[replaceIdx] = style.m;
    }
  }
  return selected;
}

function keywordLines(content: string, requirement: string): number[] {
  const tokens = requirement
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return [];
  const lines = content.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (tokens.some((t) => line.includes(t))) hits.push(i);
  }
  return hits;
}

function symbolIndex(content: string): string {
  const out: string[] = [];
  const lines = content.split("\n");
  const re =
    /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) out.push(`L${i + 1}: ${m[1]}`);
    if (out.length >= 40) break;
  }
  return out.join("\n");
}

export function buildExcerpt(
  content: string,
  requirement: string,
  maxBytes = 8 * 1024
): { text: string; index: string } {
  const lines = content.split("\n");
  const hits = keywordLines(content, requirement);
  const picked = new Set<number>();
  const lineHint = /(?:\[stdin\]:|line\s+|第\s*)(\d{1,6})/i.exec(requirement);
  if (lineHint) {
    const center = Number(lineHint[1]) - 1;
    for (let i = Math.max(0, center - 15); i <= Math.min(lines.length - 1, center + 15); i++) {
      picked.add(i);
    }
  }
  for (const h of hits.slice(0, 6)) {
    for (let i = Math.max(0, h - 8); i <= Math.min(lines.length - 1, h + 8); i++) {
      picked.add(i);
    }
  }
  if (picked.size === 0) {
    for (let i = 0; i < Math.min(60, lines.length); i++) picked.add(i);
    for (let i = Math.max(0, lines.length - 40); i < lines.length; i++) picked.add(i);
  }
  const idx = [...picked].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const i of idx) {
    const last = ranges[ranges.length - 1];
    if (!last || i > last[1] + 1) ranges.push([i, i]);
    else last[1] = i;
  }
  // 代码块只放真实文件行；行范围/符号索引放在代码块外，避免模型把它当作 SEARCH
  let text = idx.map((i) => lines[i]).join("\n");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = text.slice(0, maxBytes);
  }
  const indexParts = [
    `片段行范围：${ranges.map(([a, b]) => `L${a + 1}-L${b + 1}`).join("、")}`,
    symbolIndex(content),
  ].filter(Boolean);
  return { text, index: indexParts.join("\n") };
}

export function stubText(stubs: ContextStub[]): string {
  if (stubs.length === 0) return "";
  return stubs
    .map(
      (s) =>
        `### 依赖签名 ${s.path}（${s.role}）\n` +
        (s.exports.length ? s.exports.map((e) => `- ${e}`).join("\n") : "- （无导出）")
    )
    .join("\n\n");
}

export async function buildIterationContext(
  dir: string,
  requirement: string,
  history: string[],
  opts: BuildContextOptions = {}
): Promise<IterationContextBundle> {
  const manifest =
    opts.manifest ??
    (await readManifest(dir)) ??
    (await deriveHeuristicManifest(dir));
  const budgets = resolveBudgets(manifest.budgets);
  const budgetKB = opts.budgetKB ?? budgets.contextKB;
  const maxTargets = opts.maxTargets ?? 3;
  const recentPaths = opts.recentPaths ?? [];

  const targets = pickTargets(manifest, requirement, recentPaths, maxTargets);
  const targetPaths = new Set(targets.map((t) => t.path));
  const stubs: ContextStub[] = [];
  for (const t of targets) {
    for (const dep of t.deps) {
      const depPath = resolveDep(t.path, dep);
      if (targetPaths.has(depPath)) continue;
      const sig = moduleSignature(manifest, depPath);
      if (sig && !stubs.some((s) => s.path === sig.path)) stubs.push(sig);
    }
  }

  const requirements = history.slice(-HISTORY_TURNS).map((r) => r.slice(0, HISTORY_CHARS));
  const summary = manifestSummary(manifest).slice(0, 6 * 1024);
  const overhead =
    Buffer.byteLength(summary, "utf8") +
    Buffer.byteLength(stubText(stubs), "utf8") +
    requirements.reduce((n, r) => n + Buffer.byteLength(r, "utf8"), 0) +
    512;
  let available = Math.max(0, budgetKB * 1024 - overhead);

  const files: ContextFile[] = [];
  for (const target of targets) {
    let content: string;
    try {
      content = await readFile(path.join(dir, target.path), "utf8");
    } catch {
      continue;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    // maxKB 是生成预算，不是上下文截断线；10KB 内的目标文件应完整注入
    const softBytes = budgets.fileSoftKB * 1024;
    if (bytes <= softBytes && bytes <= available) {
      files.push({ path: target.path, content, bytes });
      available -= bytes;
      continue;
    }
    const excerpt = buildExcerpt(
      content,
      requirement,
      Math.min(8 * 1024, Math.max(1024, available))
    );
    const excerptBytes = Buffer.byteLength(excerpt.text, "utf8");
    files.push({
      path: target.path,
      content: excerpt.text,
      bytes: excerptBytes,
      truncated: true,
      index: excerpt.index,
    });
    available = Math.max(0, available - excerptBytes);
  }

  const totalBytes =
    overhead +
    files.reduce((n, f) => n + f.bytes, 0);

  return {
    manifest,
    requirements,
    files,
    stubs,
    targetPaths: [...targetPaths],
    manifestSummary: summary,
    totalBytes,
    budgetKB,
  };
}

export async function resolveNeeds(
  dir: string,
  bundle: IterationContextBundle,
  needs: string[],
  opts: { maxFiles?: number } = {}
): Promise<{ bundle: IterationContextBundle; added: string[] }> {
  const maxFiles = opts.maxFiles ?? 5;
  const added: string[] = [];
  const next: IterationContextBundle = {
    ...bundle,
    files: [...bundle.files],
    targetPaths: [...bundle.targetPaths],
    stubs: [...bundle.stubs],
  };
  for (const rel of needs.slice(0, maxFiles)) {
    if (!isValidPath(rel)) continue;
    if (next.files.some((f) => f.path === rel)) continue;
    let content: string;
    try {
      content = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (next.totalBytes + bytes > next.budgetKB * 1024) {
      const excerpt = buildExcerpt(content, rel, 4 * 1024);
      const excerptBytes = Buffer.byteLength(excerpt.text, "utf8");
      next.files.push({
        path: rel,
        content: excerpt.text,
        bytes: excerptBytes,
        truncated: true,
        index: excerpt.index,
      });
      next.totalBytes += excerptBytes;
    } else {
      next.files.push({ path: rel, content, bytes });
      next.totalBytes += bytes;
    }
    next.targetPaths.push(rel);
    added.push(rel);
  }
  return { bundle: next, added };
}