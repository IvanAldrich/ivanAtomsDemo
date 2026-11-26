import { readFile } from "node:fs/promises";
import path from "node:path";
import { isCodeFile, isManifestPath } from "./file-kinds";
import {
  DEFAULT_BUDGETS,
  resolveBudgets,
  type ManifestBudgets,
  type ModuleManifest,
} from "./manifest";
import { readTree } from "./snapshot";

export type ViolationCode =
  | "FILE_TOO_LARGE"
  | "INLINE_TOO_LARGE"
  | "INLINE_ASSET"
  | "MISSING_DEP"
  | "EXPORT_MISSING"
  | "ABSOLUTE_IMPORT"
  | "CYCLE"
  | "UNREACHABLE_MODULE"
  | "MANIFEST_DRIFT"
  | "MODULE_MODE"
  | "ENTRY_BOOTSTRAP_TIMING";

export type Violation = {
  code: ViolationCode;
  severity: "error" | "warning";
  path: string;
  actual?: string;
  limit?: string;
  message: string;
  suggestion?: string;
};

export type StructureResult = {
  violations: Violation[];
  errors: Violation[];
  warnings: Violation[];
};

export type StructureOptions = {
  manifest?: ModuleManifest | null;
  budgets?: Partial<ManifestBudgets>;
};

const JS_EXT = /\.(?:js|mjs|cjs)$/i;

function kb(bytes: number): string {
  return `${Math.round((bytes / 1024) * 10) / 10}KB`;
}

function budgetsFor(opts: StructureOptions): ManifestBudgets {
  return resolveBudgets({ ...opts.manifest?.budgets, ...opts.budgets });
}

function add(
  out: Violation[],
  v: Violation
) {
  out.push(v);
}

async function checkSizes(
  dir: string,
  files: string[],
  budgets: ManifestBudgets,
  out: Violation[]
) {
  for (const rel of files) {
    if (!isCodeFile(rel)) continue;
    let bytes: number;
    try {
      bytes = Buffer.byteLength(await readFile(path.join(dir, rel), "utf8"), "utf8");
    } catch {
      continue;
    }
    const limitKB = rel.endsWith(".html") ? budgets.htmlKB : budgets.fileHardKB;
    if (bytes > limitKB * 1024) {
      add(out, {
        code: "FILE_TOO_LARGE",
        severity: "error",
        path: rel,
        actual: kb(bytes),
        limit: `${limitKB}KB`,
        message: `文件超过模块预算：${rel} 为 ${kb(bytes)}，上限 ${limitKB}KB`,
        suggestion: `按职责拆分 ${rel}，保留原文件 re-export 以保持引用可用`,
      });
    }
  }
}

function checkInline(
  dir: string,
  files: string[],
  budgets: ManifestBudgets,
  out: Violation[]
) {
  return (async () => {
    for (const rel of files) {
      if (!isCodeFile(rel)) continue;
      let content: string;
      try {
        content = await readFile(path.join(dir, rel), "utf8");
      } catch {
        continue;
      }
      if (rel.endsWith(".html")) {
        const blocks = [
          ...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
          ...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
        ];
        for (const block of blocks) {
          const body = block[1] ?? "";
          if (!body.trim()) continue;
          const bytes = Buffer.byteLength(body, "utf8");
          if (bytes > budgets.inlineKB * 1024) {
            add(out, {
              code: "INLINE_TOO_LARGE",
              severity: "error",
              path: rel,
              actual: kb(bytes),
              limit: `${budgets.inlineKB}KB`,
              message: `内联脚本/样式超过 ${budgets.inlineKB}KB：${rel}`,
              suggestion: "抽取为独立 .js/.css 文件，并在 HTML 中通过相对路径引用",
            });
            break;
          }
        }
      }
      for (const m of content.matchAll(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/gi)) {
        const bytes = m[1].length;
        if (bytes > budgets.inlineAssetKB * 1024) {
          add(out, {
            code: "INLINE_ASSET",
            severity: "error",
            path: rel,
            actual: kb(bytes),
            limit: `${budgets.inlineAssetKB}KB`,
            message: `内联资源超过 ${budgets.inlineAssetKB}KB：${rel}`,
            suggestion: "将资源放入静态目录并以相对 URL 引用",
          });
        }
      }
    }
  })();
}

const IMPORT_RE =
  /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

function importSpecifiers(content: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function resolveLocal(fromFile: string, spec: string, fileSet: Set<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.js`,
  ];
  return candidates.find((c) => fileSet.has(c)) ?? null;
}

function htmlScriptSources(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1];
    // 站内相对引用：不以协议/http/data 开头即视为站内路径（含 "src/main.js" 这种无 ./ 前缀写法）
    if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith("data:")) continue;
    out.push(src);
  }
  return out;
}

async function checkImports(
  dir: string,
  files: string[],
  out: Violation[]
) {
  const fileSet = new Set(files);
  const jsFiles = files.filter((f) => JS_EXT.test(f));
  const graph = new Map<string, string[]>();
  const roots = new Set<string>();

  for (const rel of files) {
    if (rel.endsWith(".html")) {
      let html = "";
      try {
        html = await readFile(path.join(dir, rel), "utf8");
      } catch {
        continue;
      }
      for (const src of htmlScriptSources(html)) {
        const resolved = resolveLocal(rel, src, fileSet);
        if (resolved) roots.add(resolved);
      }
    }
  }
  if (fileSet.has("server.js")) roots.add("server.js");

  for (const rel of jsFiles) {
    let content = "";
    try {
      content = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    const edges: string[] = [];
    for (const spec of importSpecifiers(content)) {
      if (spec.startsWith("/")) {
        add(out, {
          code: "ABSOLUTE_IMPORT",
          severity: "error",
          path: rel,
          message: `禁止根绝对路径引用：${rel} -> ${spec}`,
          suggestion: "改为相对路径（./ 或 ../）",
        });
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const resolved = resolveLocal(rel, spec, fileSet);
      if (!resolved) {
        add(out, {
          code: "MISSING_DEP",
          severity: "error",
          path: rel,
          message: `import 目标不存在：${rel} -> ${spec}`,
          suggestion: "创建缺失模块或修正相对路径",
        });
        continue;
      }
      edges.push(resolved);
    }
    graph.set(rel, edges);
  }

  // 环检测
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const seenCycles = new Set<string>();
  const dfs = (node: string) => {
    const s = state.get(node);
    if (s === "done") return;
    if (s === "visiting") {
      const idx = stack.indexOf(node);
      const cycle = [...stack.slice(idx), node];
      const key = [...cycle].sort().join("|");
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        add(out, {
          code: "CYCLE",
          severity: "error",
          path: node,
          message: `检测到循环依赖：${cycle.join(" -> ")}`,
          suggestion: "抽取共享模块或调整依赖方向",
        });
      }
      return;
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const next of graph.get(node) ?? []) dfs(next);
    stack.pop();
    state.set(node, "done");
  };
  for (const n of graph.keys()) dfs(n);

  // 入口可达性（只对能确定入口的工程）
  if (roots.size > 0) {
    const reachable = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const next of graph.get(cur) ?? []) queue.push(next);
    }
    for (const rel of jsFiles) {
      if (!reachable.has(rel)) {
        add(out, {
          code: "UNREACHABLE_MODULE",
          severity: "warning",
          path: rel,
          message: `模块不可从入口到达：${rel}`,
          suggestion: "确认是否遗漏 import，或移除未使用模块",
        });
      }
    }
  }
}

async function checkManifestDrift(
  dir: string,
  files: string[],
  manifest: ModuleManifest | null | undefined,
  out: Violation[]
) {
  if (!manifest) return;
  const codeFiles = new Set(files.filter((f) => isCodeFile(f) && !isManifestPath(f)));
  const declared = new Set(manifest.modules.map((m) => m.path));
  for (const m of manifest.modules) {
    if (!codeFiles.has(m.path)) {
      add(out, {
        code: "MANIFEST_DRIFT",
        severity: "error",
        path: m.path,
        message: `manifest 声明的模块不存在：${m.path}`,
        suggestion: "补回文件、从 manifest 移除，或重新生成 manifest",
      });
    }
  }
  for (const rel of codeFiles) {
    if (!declared.has(rel) && rel !== "server.js") {
      add(out, {
        code: "MANIFEST_DRIFT",
        severity: "warning",
        path: rel,
        message: `文件未在 manifest 中声明：${rel}`,
        suggestion: "补充 manifest 条目，或在拆分/新增后同步更新",
      });
    }
  }
}

async function checkModuleMode(
  dir: string,
  files: string[],
  out: Violation[]
) {
  const browserJs = files.filter((f) => JS_EXT.test(f) && f.startsWith("public/"));
  if (browserJs.length === 0) return;
  let usesImport = false;
  for (const rel of browserJs) {
    try {
      const content = await readFile(path.join(dir, rel), "utf8");
      if (/^\s*(?:import|export)\s/m.test(content)) {
        usesImport = true;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!usesImport) return;

  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  if (htmlFiles.length > 0) {
    let hasModuleTag = false;
    for (const rel of htmlFiles) {
      try {
        const html = await readFile(path.join(dir, rel), "utf8");
        if (/<script\b[^>]*type\s*=\s*["']module["']/i.test(html)) hasModuleTag = true;
      } catch {
        /* ignore */
      }
    }
    if (!hasModuleTag) {
      add(out, {
        code: "MODULE_MODE",
        severity: "error",
        path: htmlFiles[0],
        message: "浏览器模块使用了 import/export，但 HTML 未声明 type=\"module\"",
        suggestion: "为入口 script 增加 type=\"module\"",
      });
    }
  }

  if (files.includes("server.js")) {
    try {
      const server = await readFile(path.join(dir, "server.js"), "utf8");
      const hasJsMime = /(text|application)\/javascript/i.test(server);
      if (!hasJsMime && /\.js/.test(server)) {
        add(out, {
          code: "MODULE_MODE",
          severity: "warning",
          path: "server.js",
          message: "静态服务未显式返回 JS MIME（text/javascript）",
          suggestion: "为 .js/.css 响应设置正确的 Content-Type",
        });
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * 导出解析：import 的命名绑定必须在目标模块的实际导出中存在。
 * 这是模块链接级别的确定性检查——名字不存在时浏览器会直接拒绝加载整个模块图。
 */
function extractExports(content: string): Set<string> {
  const exports = new Set<string>();
  for (const m of content.matchAll(
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
  )) {
    exports.add(m[1]);
  }
  for (const m of content.matchAll(
    /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    exports.add(m[1]);
  }
  for (const m of content.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) {
    exports.add(m[1]);
  }
  for (const m of content.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const name of m[1].split(",")) {
      const trimmed = name.trim().split(/\s+as\s+/)[0].trim();
      if (trimmed) exports.add(trimmed);
    }
  }
  if (/^export\s+default/m.test(content)) exports.add("default");
  if (/^export\s+\*\s+from/m.test(content)) exports.add("*");
  return exports;
}

function extractNamedImports(
  content: string
): Array<{ names: string[]; from: string }> {
  const imports: Array<{ names: string[]; from: string }> = [];
  for (const m of content.matchAll(
    /^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm
  )) {
    const names = m[1]
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    imports.push({ names, from: m[2] });
  }
  return imports;
}

async function checkExportResolution(
  dir: string,
  files: string[],
  out: Violation[]
) {
  const fileSet = new Set(files);
  const jsFiles = files.filter((f) => JS_EXT.test(f));
  const exportMap = new Map<string, Set<string>>();

  for (const rel of jsFiles) {
    try {
      const content = await readFile(path.join(dir, rel), "utf8");
      exportMap.set(rel, extractExports(content));
    } catch {
      /* ignore */
    }
  }

  for (const rel of jsFiles) {
    let content: string;
    try {
      content = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    for (const imp of extractNamedImports(content)) {
      if (!imp.from.startsWith(".")) continue;
      const resolved = resolveLocal(rel, imp.from, fileSet);
      if (!resolved) continue; // MISSING_DEP handles missing files
      const targetExports = exportMap.get(resolved);
      if (!targetExports) continue;
      for (const name of imp.names) {
        if (!targetExports.has(name) && !targetExports.has("*")) {
          add(out, {
            code: "EXPORT_MISSING",
            severity: "error",
            path: rel,
            message: `import 的名称未被目标模块导出：${rel} 从 ${imp.from} 导入 { ${name} }，但 ${resolved} 实际导出：${[...targetExports].join(", ") || "（无）"}`,
            suggestion: `修正 import 名称为 ${resolved} 的实际导出，或在 ${resolved} 中补充导出 ${name}`,
          });
        }
      }
    }
  }
}

/**
 * 入口自启动时序：顶层监听 DOMContentLoaded/load 而没有 readyState 兜底的脚本，
 * 在事件之后才执行时初始化永远不会运行（「点击开始无响应」的直接根因）。
 */
async function checkBootstrapTiming(
  dir: string,
  files: string[],
  out: Violation[]
) {
  const re =
    /^(?:document\.addEventListener\(\s*['"](?:DOMContentLoaded|load)['"]|window\.addEventListener\(\s*['"]load['"])/m;
  for (const rel of files) {
    if (!JS_EXT.test(rel) || !rel.startsWith("public/")) continue;
    let content: string;
    try {
      content = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    if (!re.test(content)) continue;
    if (/document\.readyState/.test(content)) continue;
    add(out, {
      code: "ENTRY_BOOTSTRAP_TIMING",
      severity: "error",
      path: rel,
      message: `脚本顶层监听 DOMContentLoaded/load 且未用 document.readyState 兜底：脚本在事件之后执行时初始化不会运行`,
      suggestion:
        "改为：if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();",
    });
  }
}

export async function validateStructure(
  dir: string,
  opts: StructureOptions = {}
): Promise<StructureResult> {
  const budgets = budgetsFor(opts);
  let files: string[] = [];
  try {
    files = await readTree(dir);
  } catch {
    return { violations: [], errors: [], warnings: [] };
  }
  const violations: Violation[] = [];
  await checkSizes(dir, files, budgets, violations);
  await checkInline(dir, files, budgets, violations);
  await checkImports(dir, files, violations);
  await checkManifestDrift(dir, files, opts.manifest, violations);
  await checkModuleMode(dir, files, violations);
  await checkBootstrapTiming(dir, files, violations);
  await checkExportResolution(dir, files, violations);

  return {
    violations,
    errors: violations.filter((v) => v.severity === "error"),
    warnings: violations.filter((v) => v.severity === "warning"),
  };
}

export function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => {
      const parts = [`[${v.code}] ${v.path}: ${v.message}`];
      if (v.actual && v.limit) parts.push(`实际 ${v.actual} / 限制 ${v.limit}`);
      if (v.suggestion) parts.push(`建议：${v.suggestion}`);
      return parts.join(" | ");
    })
    .join("\n");
}

export function defaultBudgets(): ManifestBudgets {
  return resolveBudgets(DEFAULT_BUDGETS);
}