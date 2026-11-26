import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProtocolError } from "./protocol";
import { isCodeFile, MANIFEST_PATH } from "./file-kinds";
import { readTree } from "./snapshot";

export type ManifestBudgets = {
  fileSoftKB: number;
  fileHardKB: number;
  htmlKB: number;
  inlineKB: number;
  contextKB: number;
  inlineAssetKB: number;
};

export type ModuleEntry = {
  path: string;
  role: string;
  exports: string[];
  deps: string[];
  maxKB?: number;
};

export type ModuleManifest = {
  schemaVersion: 1;
  profile: string;
  entry: string;
  budgets: ManifestBudgets;
  modules: ModuleEntry[];
};

export const DEFAULT_BUDGETS: ManifestBudgets = {
  fileSoftKB: 10,
  fileHardKB: 16,
  htmlKB: 4,
  inlineKB: 2,
  contextKB: 24,
  inlineAssetKB: 8,
};

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveBudgets(partial?: Partial<ManifestBudgets>): ManifestBudgets {
  return {
    fileSoftKB: partial?.fileSoftKB ?? envInt("MODULAR_FILE_SOFT_KB", DEFAULT_BUDGETS.fileSoftKB),
    fileHardKB: partial?.fileHardKB ?? envInt("MODULAR_FILE_HARD_KB", DEFAULT_BUDGETS.fileHardKB),
    htmlKB: partial?.htmlKB ?? envInt("MODULAR_HTML_KB", DEFAULT_BUDGETS.htmlKB),
    inlineKB: partial?.inlineKB ?? envInt("MODULAR_INLINE_KB", DEFAULT_BUDGETS.inlineKB),
    contextKB: partial?.contextKB ?? envInt("MODULAR_CONTEXT_KB", DEFAULT_BUDGETS.contextKB),
    inlineAssetKB:
      partial?.inlineAssetKB ?? envInt("MODULAR_INLINE_ASSET_KB", DEFAULT_BUDGETS.inlineAssetKB),
  };
}

function normalizeEntry(entry: Partial<ModuleEntry>): ModuleEntry {
  return {
    path: entry.path ?? "",
    role: entry.role ?? "",
    exports: Array.isArray(entry.exports) ? entry.exports : [],
    deps: Array.isArray(entry.deps) ? entry.deps : [],
    maxKB: Number.isFinite(entry.maxKB) ? Number(entry.maxKB) : undefined,
  };
}

export function normalizeManifest(raw: Partial<ModuleManifest>): ModuleManifest {
  const modules = Array.isArray(raw.modules) ? raw.modules.map(normalizeEntry) : [];
  // 入口路径自动纠偏：模型常输出 "/public/index.html"、"./x" 或与模块清单不一致的入口
  let entry = String(raw.entry ?? "").trim().replace(/^\.?\//, "");
  if (!isValidManifestPath(entry) || !modules.some((m) => m.path === entry)) {
    entry =
      modules.find((m) => m.role === "entry-html")?.path ??
      modules[0]?.path ??
      "";
  }
  return {
    schemaVersion: 1,
    profile: raw.profile ?? "custom",
    entry,
    budgets: resolveBudgets(raw.budgets),
    modules,
  };
}

function resolveRelative(fromModule: string, dep: string): string {
  if (!dep.startsWith(".")) return dep;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromModule), dep));
}

function modulePathSet(manifest: ModuleManifest): Set<string> {
  return new Set(manifest.modules.map((m) => m.path));
}

function isValidManifestPath(p: string): boolean {
  if (!p || p.includes("\0") || path.isAbsolute(p)) return false;
  const norm = path.posix.normalize(p);
  return norm !== "." && !norm.startsWith("..") && !norm.split("/").includes("..");
}

export function validateManifest(
  manifest: ModuleManifest,
  opts: { mode?: "generated" | "heuristic" } = {}
): void {
  const mode = opts.mode ?? "generated";
  const minModules = mode === "generated" ? 4 : 1;
  const modules = manifest.modules;

  if (!manifest.profile.trim()) throw new ProtocolError("manifest 缺少 profile");
  const b = manifest.budgets;
  const inRange = (n: number, min: number, max: number) =>
    Number.isFinite(n) && n >= min && n <= max;
  if (
    !inRange(b.fileSoftKB, 6, 16) ||
    !inRange(b.fileHardKB, 10, 24) ||
    !inRange(b.htmlKB, 2, 8) ||
    !inRange(b.inlineKB, 1, 4) ||
    !inRange(b.contextKB, 8, 48) ||
    !inRange(b.inlineAssetKB, 2, 16)
  ) {
    throw new ProtocolError(
      "manifest 预算超出允许范围（soft 6–16 / hard 10–24 / html 2–8 / inline 1–4 / context 8–48 / asset 2–16）"
    );
  }
  if (b.fileSoftKB > b.fileHardKB) {
    throw new ProtocolError("manifest 预算非法：fileSoftKB 不能大于 fileHardKB");
  }
  if (!isValidManifestPath(manifest.entry)) {
    throw new ProtocolError(`manifest 入口路径非法：${manifest.entry}`);
  }
  if (modules.length < minModules || modules.length > 24) {
    throw new ProtocolError(
      `manifest 模块数需在 ${minModules}–24 之间，当前 ${modules.length}`
    );
  }
  const paths = modulePathSet(manifest);
  if (!paths.has(manifest.entry)) {
    throw new ProtocolError(`manifest 入口不在模块清单中：${manifest.entry}`);
  }

  const seen = new Set<string>();
  for (const m of modules) {
    if (!isValidManifestPath(m.path)) {
      throw new ProtocolError(`manifest 模块路径非法：${m.path}`);
    }
    if (seen.has(m.path)) {
      throw new ProtocolError(`manifest 模块重复：${m.path}`);
    }
    seen.add(m.path);
    if (!m.role.trim()) {
      throw new ProtocolError(`manifest 模块缺少职责：${m.path}`);
    }
    if (m.maxKB !== undefined && (m.maxKB <= 0 || m.maxKB > manifest.budgets.fileHardKB)) {
      throw new ProtocolError(
        `manifest 模块预算非法：${m.path}（maxKB=${m.maxKB}，上限 ${manifest.budgets.fileHardKB}）`
      );
    }
    for (const dep of m.deps) {
      const resolved = resolveRelative(m.path, dep);
      if (/^[a-z]+:/i.test(dep) || !dep.startsWith(".")) {
        throw new ProtocolError(
          `manifest 依赖需为工程内相对路径：${m.path} -> ${dep}`
        );
      }
      if (!paths.has(resolved)) {
        throw new ProtocolError(
          `manifest 依赖不存在：${m.path} -> ${dep}（解析为 ${resolved}）`
        );
      }
    }
  }
}

export function parseManifestJson(raw: string): ModuleManifest {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new ProtocolError(`计划输出不是 manifest JSON：${raw.slice(0, 300)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new ProtocolError(
      `manifest JSON 解析失败：${err instanceof Error ? err.message : "invalid JSON"}`
    );
  }
  const manifest = normalizeManifest(parsed as Partial<ModuleManifest>);
  validateManifest(manifest);
  return manifest;
}

export async function readManifest(dir: string): Promise<ModuleManifest | null> {
  try {
    const raw = await readFile(path.join(dir, MANIFEST_PATH), "utf8");
    return normalizeManifest(JSON.parse(raw) as Partial<ModuleManifest>);
  } catch {
    return null;
  }
}

export async function writeManifest(dir: string, manifest: ModuleManifest): Promise<void> {
  const dest = path.join(dir, MANIFEST_PATH);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(manifest, null, 2), "utf8");
}

export function findModule(
  manifest: ModuleManifest,
  filePath: string
): ModuleEntry | undefined {
  return manifest.modules.find((m) => m.path === filePath);
}

export function resolveDep(fromModule: string, dep: string): string {
  return resolveRelative(fromModule, dep);
}

export function moduleSignature(
  manifest: ModuleManifest,
  filePath: string
): { path: string; role: string; exports: string[] } | null {
  const m = findModule(manifest, filePath);
  return m ? { path: m.path, role: m.role, exports: m.exports } : null;
}

export function dependencySignatures(
  manifest: ModuleManifest,
  entry: ModuleEntry
): Array<{ path: string; role: string; exports: string[] }> {
  return entry.deps
    .map((dep) => moduleSignature(manifest, resolveRelative(entry.path, dep)))
    .filter((m): m is { path: string; role: string; exports: string[] } => Boolean(m));
}

export function topologicalModules(manifest: ModuleManifest): ModuleEntry[] {
  const byPath = new Map(manifest.modules.map((m) => [m.path, m]));
  const visited = new Map<string, "visiting" | "done">();
  const order: ModuleEntry[] = [];

  const visit = (p: string, trail: string[]) => {
    const state = visited.get(p);
    if (state === "done") return;
    if (state === "visiting") {
      throw new ProtocolError(`manifest 存在循环依赖：${[...trail, p].join(" -> ")}`);
    }
    const m = byPath.get(p);
    if (!m) return;
    visited.set(p, "visiting");
    for (const dep of m.deps) visit(resolveRelative(p, dep), [...trail, p]);
    visited.set(p, "done");
    order.push(m);
  };

  for (const m of manifest.modules) visit(m.path, []);
  return order;
}

export function manifestSummary(manifest: ModuleManifest): string {
  return [
    `profile: ${manifest.profile}；entry: ${manifest.entry}；soft ${manifest.budgets.fileSoftKB}KB / hard ${manifest.budgets.fileHardKB}KB`,
    ...manifest.modules.map(
      (m) =>
        `- ${m.path} — ${m.role}` +
        (m.exports.length ? `；exports: ${m.exports.join(", ")}` : "") +
        (m.maxKB ? `；预算 ${m.maxKB}KB` : "")
    ),
  ].join("\n");
}

export function inferRole(filePath: string): string {
  const p = filePath.toLowerCase();
  if (p.endsWith("index.html")) return "entry-html";
  if (p.includes("engine")) return "game-loop";
  if (p.includes("input")) return "input";
  if (p.includes("render")) return "renderer";
  if (p.includes("entit")) return "entities";
  if (p.includes("level")) return "levels";
  if (p.includes("hud") || p.includes("ui")) return "ui";
  if (p.includes("storage") || p.includes("db") || p.includes("store")) return "storage";
  if (p.includes("audio")) return "audio";
  if (p.includes("style") || p.endsWith(".css")) return "styles";
  if (p === "server.js" || p.endsWith("/server.js")) return "server";
  if (p === "main.js" || p.endsWith("/main.js")) return "bootstrap";
  return "module";
}

export async function deriveHeuristicManifest(dir: string): Promise<ModuleManifest> {
  const tree = await readTree(dir);
  const codeFiles = tree.filter(isCodeFile);
  const entry =
    codeFiles.find((p) => p.endsWith("index.html")) ??
    codeFiles.find((p) => p === "server.js") ??
    codeFiles[0] ??
    "";
  const modules: ModuleEntry[] = codeFiles.map((p) => ({
    path: p,
    role: inferRole(p),
    exports: [],
    deps: [],
  }));
  const manifest: ModuleManifest = {
    schemaVersion: 1,
    profile: "legacy",
    entry,
    budgets: resolveBudgets(),
    modules,
  };
  validateManifest(manifest, { mode: "heuristic" });
  return manifest;
}

/**
 * 让 manifest 与磁盘保持一致：新增代码文件按路径推断 role 加入，删除的文件移除。
 * 保留既有模块的 role/exports/deps，避免覆盖模型已有的契约信息。
 */
export async function syncManifestFiles(
  dir: string,
  manifest: ModuleManifest
): Promise<ModuleManifest> {
  const tree = await readTree(dir);
  const codeFiles = tree.filter(isCodeFile);
  const existing = new Map(manifest.modules.map((m) => [m.path, m]));
  const modules: ModuleEntry[] = codeFiles.map(
    (p) =>
      existing.get(p) ?? {
        path: p,
        role: inferRole(p),
        exports: [],
        deps: [],
        maxKB: manifest.budgets.fileSoftKB,
      }
  );
  const paths = new Set(modules.map((m) => m.path));
  let entry = manifest.entry;
  if (!paths.has(entry)) {
    entry =
      codeFiles.find((p) => p.endsWith("index.html")) ??
      codeFiles.find((p) => p === "server.js") ??
      codeFiles[0] ??
      entry;
  }
  return { ...manifest, entry, modules };
}

export function moduleLimitKB(manifest: ModuleManifest, entry: ModuleEntry): number {
  return entry.maxKB ?? manifest.budgets.fileSoftKB;
}

export function isOverHardLimit(
  manifest: ModuleManifest,
  filePath: string,
  bytes: number
): boolean {
  if (filePath.endsWith(".html")) {
    return bytes > manifest.budgets.htmlKB * 1024;
  }
  return bytes > manifest.budgets.fileHardKB * 1024;
}