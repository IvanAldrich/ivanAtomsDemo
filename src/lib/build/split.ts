import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isCodeFile } from "./file-kinds";
import { isValidPath } from "./protocol";
import {
  resolveBudgets,
  type ModuleEntry,
  type ModuleManifest,
} from "./manifest";
import { readTree } from "./snapshot";

export type SymbolInfo = {
  name: string;
  names: string[];
  kind: string;
  start: number;
  end: number;
};

export type SplitPlanFile = {
  path: string;
  role: string;
  exports: string[];
  symbols: string[];
};

export type SplitPlan = {
  source: string;
  newFiles: SplitPlanFile[];
};

type TsModule = typeof import("typescript");
let cachedTs: TsModule | null | undefined;

async function loadTs(): Promise<TsModule | null> {
  if (cachedTs !== undefined) return cachedTs;
  try {
    cachedTs = await import("typescript");
  } catch {
    cachedTs = null;
  }
  return cachedTs;
}

function variableNames(declarationList: {
  declarations: ReadonlyArray<{ name?: { getText?: () => string } }>;
}): string[] {
  return declarationList.declarations
    .map((d) => d.name?.getText?.() ?? "")
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

function extractWithTs(ts: TsModule, filePath: string, content: string): SymbolInfo[] {
  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const out: SymbolInfo[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) continue;
    const start = stmt.getFullStart();
    const end = stmt.getEnd();
    if (end <= start) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name.text, names: [stmt.name.text], kind: "function", start, end });
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name.text, names: [stmt.name.text], kind: "class", start, end });
    } else if (ts.isVariableStatement(stmt)) {
      const names = variableNames(stmt.declarationList);
      if (names.length > 0) {
        out.push({ name: names.join(","), names, kind: "variable", start, end });
      }
    }
  }
  return out;
}

function extractWithRegex(content: string): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  const re =
    /(^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const start = m.index + (m[1] ? 1 : 0);
    const name = m[2];
    let depth = 0;
    let seenBrace = false;
    let end = start;
    for (let i = m.index + m[0].length; i < content.length; i++) {
      const ch = content[i];
      if (ch === "{") {
        depth += 1;
        seenBrace = true;
      } else if (ch === "}") {
        depth -= 1;
        if (seenBrace && depth === 0) {
          end = i + 1;
          break;
        }
      } else if (ch === ";" && !seenBrace) {
        end = i + 1;
        break;
      }
    }
    if (end <= start) continue;
    if (out.some((s) => start >= s.start && start < s.end)) continue;
    out.push({ name, names: [name], kind: "declaration", start, end });
  }
  return out;
}

export async function extractTopLevelSymbols(
  filePath: string,
  content: string
): Promise<SymbolInfo[]> {
  const ts = await loadTs();
  const symbols = ts ? extractWithTs(ts, filePath, content) : extractWithRegex(content);
  return symbols.sort((a, b) => a.start - b.start);
}

function groupFor(name: string): string {
  const n = name.toLowerCase();
  if (/(render|draw|paint|canvas)/.test(n)) return "render";
  if (/(input|key|touch|pointer|mouse)/.test(n)) return "input";
  if (/(player|enemy|entity|entities|bullet|item)/.test(n)) return "entities";
  if (/(level|map|spawn|wave)/.test(n)) return "levels";
  if (/(hud|ui|menu|score|status|overlay)/.test(n)) return "hud";
  if (/(save|load|storage|persist)/.test(n)) return "storage";
  if (/(audio|sound|music)/.test(n)) return "audio";
  return "logic";
}

function relativeDep(fromPath: string, toPath: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromPath), toPath);
  return rel.startsWith(".") ? rel : `./${rel}`;
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

function resolveVirtual(
  files: Set<string>,
  fromFile: string,
  spec: string
): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  for (const candidate of [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.js`,
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function validateVirtualGraph(files: Map<string, string>): string | null {
  const fileSet = new Set(files.keys());
  const graph = new Map<string, string[]>();
  for (const [file, content] of files) {
    if (!/\.(?:js|mjs|cjs)$/i.test(file)) continue;
    const edges: string[] = [];
    for (const spec of importSpecifiers(content)) {
      if (!spec.startsWith(".")) continue;
      const resolved = resolveVirtual(fileSet, file, spec);
      if (!resolved) return `${file} -> ${spec} 不存在`;
      edges.push(resolved);
    }
    graph.set(file, edges);
  }
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  let cycle: string | null = null;
  const visit = (node: string) => {
    if (cycle) return;
    const s = state.get(node);
    if (s === "done") return;
    if (s === "visiting") {
      const idx = stack.indexOf(node);
      cycle = [...stack.slice(idx), node].join(" -> ");
      return;
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    state.set(node, "done");
  };
  for (const node of graph.keys()) {
    visit(node);
    if (cycle) break;
  }
  return cycle ? `循环依赖：${cycle}` : null;
}

export function planDeterministicSplit(
  sourcePath: string,
  symbols: SymbolInfo[],
  existingFiles: string[] = []
): SplitPlan {
  const dir = path.posix.dirname(sourcePath);
  const base = path.posix.basename(sourcePath, path.posix.extname(sourcePath));
  const partsDir = path.posix.join(dir, `${base}-parts`);
  const groups = new Map<string, SymbolInfo[]>();
  for (const s of symbols) {
    const key = groupFor(s.names[0] ?? s.name);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }
  if (groups.size === 1) {
    // 单一职责：按体量对半拆，保证至少产生两个文件
    const all = [...groups.values()][0];
    if (all.length >= 2) {
      const mid = Math.ceil(all.length / 2);
      groups.clear();
      groups.set("part1", all.slice(0, mid));
      groups.set("part2", all.slice(mid));
    }
  }
  const used = new Set(existingFiles);
  const newFiles: SplitPlanFile[] = [];
  for (const [key, list] of groups) {
    if (list.length === 0) continue;
    let candidate = path.posix.join(partsDir, `${key}.js`);
    let n = 2;
    while (used.has(candidate) || candidate === sourcePath) {
      candidate = path.posix.join(partsDir, `${key}-${n++}.js`);
    }
    used.add(candidate);
    const exports = list.flatMap((s) => s.names);
    newFiles.push({
      path: candidate,
      role: key === "logic" ? `${base}-logic` : key,
      exports,
      symbols: list.map((s) => s.name),
    });
  }
  return { source: sourcePath, newFiles };
}

export function parseSplitPlan(raw: string): SplitPlan {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("拆分计划不是 JSON 对象");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as SplitPlan;
  if (!parsed.source || !Array.isArray(parsed.newFiles) || parsed.newFiles.length < 2) {
    throw new Error("拆分计划缺少 source 或至少两个 newFiles");
  }
  if (!isValidPath(parsed.source)) {
    throw new Error(`拆分计划 source 路径非法：${parsed.source}`);
  }
  for (const f of parsed.newFiles) {
    if (!f.path || !f.role || !Array.isArray(f.symbols) || !Array.isArray(f.exports)) {
      throw new Error(`拆分计划文件条目非法：${JSON.stringify(f)}`);
    }
    if (!isValidPath(f.path)) {
      throw new Error(`拆分计划目标路径非法：${f.path}`);
    }
  }
  return parsed;
}

function withExport(text: string): string {
  const first = text.trimStart();
  if (/^export\b/.test(first)) return text;
  return text.replace(
    /^(\s*)(async\s+function|function|class|const|let|var)\b/,
    "$1export $2"
  );
}

function references(text: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

export type ApplySplitResult = {
  changed: string[];
  manifest: ModuleManifest;
  source: string;
  newFiles: string[];
};

export async function applySplitPlan(
  dir: string,
  plan: SplitPlan,
  manifest: ModuleManifest,
  symbols: SymbolInfo[]
): Promise<ApplySplitResult> {
  const sourceContent = await readFile(path.join(dir, plan.source), "utf8");
  const originalImports = [...sourceContent.matchAll(/^import\s+[\s\S]*?;$/gm)].map(
    (m) => m[0]
  );
  const byName = new Map<string, SymbolInfo>();
  for (const s of symbols) {
    for (const n of s.names) byName.set(n, s);
  }

  const groupOf = new Map<string, SplitPlanFile>();
  for (const f of plan.newFiles) {
    for (const name of f.symbols) {
      for (const n of byName.get(name)?.names ?? [name]) groupOf.set(n, f);
    }
  }

  const ranges = new Map<string, SymbolInfo>();
  for (const f of plan.newFiles) {
    for (const name of f.symbols) {
      const s = byName.get(name);
      if (s) ranges.set(s.name, s);
    }
  }

  const newContents = new Map<string, string>();
  for (const f of plan.newFiles) {
    const texts: string[] = [];
    const own = new Set(f.symbols.flatMap((n) => byName.get(n)?.names ?? [n]));
    for (const name of f.symbols) {
      const s = byName.get(name);
      if (!s) continue;
      texts.push(withExport(sourceContent.slice(s.start, s.end).trim()));
    }
    const body = texts.join("\n\n");
    const importLines: string[] = [];
    const byTarget = new Map<string, string[]>();
    for (const [otherName, target] of groupOf) {
      if (target.path === f.path) continue;
      if (own.has(otherName)) continue;
      if (!references(body, otherName)) continue;
      const list = byTarget.get(target.path) ?? [];
      if (!list.includes(otherName)) list.push(otherName);
      byTarget.set(target.path, list);
    }
    for (const [target, names] of byTarget) {
      importLines.push(
        `import { ${names.join(", ")} } from "${relativeDep(f.path, target)}";`
      );
    }
    const imports = [...new Set([...originalImports, ...importLines])];
    newContents.set(f.path, [...imports, imports.length ? "" : "", body].join("\n"));
  }

  // 原文件：移除已搬移的声明，保留其余语句，补 import 与 re-export
  const sortedRanges = [...ranges.values()].sort((a, b) => b.start - a.start);
  let remaining = sourceContent;
  for (const r of sortedRanges) {
    remaining = remaining.slice(0, r.start) + remaining.slice(r.end);
  }
  const movedNames = new Map<string, string>();
  for (const [name, target] of groupOf) movedNames.set(name, target.path);
  const neededImports = new Map<string, string[]>();
  for (const [name, target] of movedNames) {
    if (!references(remaining, name)) continue;
    const list = neededImports.get(target) ?? [];
    list.push(name);
    neededImports.set(target, list);
  }
  const header: string[] = [];
  for (const [target, names] of neededImports) {
    header.push(`import { ${names.join(", ")} } from "${relativeDep(plan.source, target)}";`);
  }
  for (const f of plan.newFiles) {
    header.push(`export * from "${relativeDep(plan.source, f.path)}";`);
  }
  const nextSource = `${header.join("\n")}\n${header.length ? "\n" : ""}${remaining.trim()}\n`;

  // 写入前做虚拟图校验：缺失依赖或循环依赖时放弃拆分，交给修复轮
  const tree = await readTree(dir);
  const virtual = new Map<string, string>();
  for (const rel of tree) {
    if (!/\.(?:js|mjs|cjs)$/i.test(rel)) continue;
    try {
      virtual.set(rel, await readFile(path.join(dir, rel), "utf8"));
    } catch {
      /* ignore */
    }
  }
  for (const [p, content] of newContents) virtual.set(p, content);
  virtual.set(plan.source, nextSource);
  const unsafe = validateVirtualGraph(virtual);
  if (unsafe) throw new Error(`拆分计划不安全：${unsafe}`);

  await writeFile(path.join(dir, plan.source), nextSource, "utf8");
  for (const [p, content] of newContents) {
    const dest = path.join(dir, p);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }

  // 更新 manifest
  const sourceEntry = manifest.modules.find((m) => m.path === plan.source);
  const newEntries: ModuleEntry[] = [];
  for (const f of plan.newFiles) {
    const deps: string[] = [];
    const content = newContents.get(f.path) ?? "";
    for (const other of plan.newFiles) {
      if (other.path === f.path) continue;
      if (content.includes(`"${relativeDep(f.path, other.path)}"`)) {
        deps.push(relativeDep(f.path, other.path));
      }
    }
    newEntries.push({
      path: f.path,
      role: f.role,
      exports: f.exports,
      deps,
      maxKB: manifest.budgets.fileSoftKB,
    });
  }
  if (sourceEntry) {
    sourceEntry.role = `${sourceEntry.role}-facade`;
    const depSet = new Set(sourceEntry.deps);
    for (const f of plan.newFiles) depSet.add(relativeDep(plan.source, f.path));
    sourceEntry.deps = [...depSet];
    sourceEntry.maxKB = manifest.budgets.fileSoftKB;
  }
  manifest.modules.push(...newEntries);

  return {
    changed: [plan.source, ...plan.newFiles.map((f) => f.path)],
    manifest,
    source: plan.source,
    newFiles: plan.newFiles.map((f) => f.path),
  };
}

export async function splitFile(
  dir: string,
  filePath: string,
  manifest: ModuleManifest,
  existingFiles?: string[]
): Promise<ApplySplitResult | null> {
  let content: string;
  try {
    content = await readFile(path.join(dir, filePath), "utf8");
  } catch {
    return null;
  }
  const bytes = Buffer.byteLength(content, "utf8");
  // 只有超过 hard 的文件才拆分；soft–hard 之间交给修复轮，避免拆出循环/缺失依赖
  if (bytes <= resolveBudgets(manifest.budgets).fileHardKB * 1024) return null;
  const symbols = await extractTopLevelSymbols(filePath, content);
  if (symbols.length < 2) return null;
  const plan = planDeterministicSplit(filePath, symbols, existingFiles);
  if (plan.newFiles.length < 2) return null;
  try {
    return await applySplitPlan(dir, plan, manifest, symbols);
  } catch {
    return null;
  }
}

export type AutoSplitResult = {
  splits: number;
  changed: string[];
  manifest: ModuleManifest;
};

export async function autoSplitOversized(
  dir: string,
  manifest: ModuleManifest,
  opts: { maxPasses?: number; onLog?: (line: string) => void } = {}
): Promise<AutoSplitResult> {
  const maxPasses = opts.maxPasses ?? 2;
  const budgets = resolveBudgets(manifest.budgets);
  let splits = 0;
  const changed: string[] = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const tree = await readTree(dir);
    let didSplit = false;
    for (const rel of tree) {
      if (!isCodeFile(rel) || rel.endsWith(".html") || rel.endsWith(".css")) continue;
      let bytes = 0;
      try {
        bytes = Buffer.byteLength(await readFile(path.join(dir, rel), "utf8"), "utf8");
      } catch {
        continue;
      }
      if (bytes <= budgets.fileHardKB * 1024) continue;
      const result = await splitFile(dir, rel, manifest, tree);
      if (!result) {
        opts.onLog?.(`[split] ${rel} 跳过：文件未超过 hard 或拆分计划不安全`);
        continue;
      }
      didSplit = true;
      splits += 1;
      changed.push(...result.changed);
      opts.onLog?.(`[split] ${rel} -> ${result.newFiles.join(", ")}`);
    }
    if (!didSplit) break;
  }
  return { splits, changed, manifest };
}