import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 最新快照目录（v{n} 取最大 n）；无快照返回 null */
export async function latestSnapshot(projectId: string): Promise<string | null> {
  const snapshotsRoot = path.join(
    process.cwd(),
    "storage",
    "projects",
    projectId,
    "snapshots"
  );
  let entries: string[];
  try {
    entries = await readdir(snapshotsRoot);
  } catch {
    return null;
  }
  const versions = entries
    .map((e) => /^v(\d+)$/.exec(e))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  if (versions.length === 0) return null;
  const max = Math.max(...versions);
  return path.join(snapshotsRoot, `v${max}`);
}

/** 清理未提交的候选快照（失败轮残留），避免被当成下一次迭代基线 */
export async function cleanupUncommittedSnapshots(
  projectId: string,
  committedVersions: Set<number>
): Promise<number> {
  const snapshotsRoot = path.join(
    process.cwd(),
    "storage",
    "projects",
    projectId,
    "snapshots"
  );
  let entries: string[];
  try {
    entries = await readdir(snapshotsRoot);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const m = /^v(\d+)$/.exec(entry);
    if (!m) continue;
    if (committedVersions.has(Number(m[1]))) continue;
    await rm(path.join(snapshotsRoot, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** 快照 GC：仅保留最新 N 个版本目录，但绝不删除仍在运行/当前版本的目录 */
export async function gcSnapshots(
  projectId: string,
  keep = 3,
  protectedDirs: string[] = []
): Promise<number> {
  const snapshotsRoot = path.join(
    process.cwd(),
    "storage",
    "projects",
    projectId,
    "snapshots"
  );
  let entries: string[];
  try {
    entries = await readdir(snapshotsRoot);
  } catch {
    return 0;
  }
  const protect = new Set(protectedDirs.map((p) => path.resolve(p)));
  const versions = entries
    .map((e) => ({ name: e, n: Number(/^v(\d+)$/.exec(e)?.[1] ?? NaN) }))
    .filter((v) => Number.isInteger(v.n))
    .sort((a, b) => b.n - a.n);
  let removed = 0;
  for (const v of versions.slice(keep)) {
    const full = path.join(snapshotsRoot, v.name);
    if (protect.has(path.resolve(full))) continue;
    await rm(full, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export async function readTree(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(cur: string) {
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".git", ".npm", ".cache", ".atoms"].includes(e.name)) continue;
        await walk(full);
      } else {
        out.push(path.relative(dir, full));
      }
    }
  }
  await walk(dir);
  return out.sort();
}

/**
 * 将生成计划写入快照：基线与目标不同则先拷贝基线再应用；
 * 基线与目标相同（原地修复）时不做清空，仅应用写入/编辑/删除。
 * EDIT 采用 SEARCH/REPLACE：先精确匹配，失败时按行尾空白容忍匹配。
 */
export async function writeSnapshot(
  baseDir: string | null,
  targetDir: string,
  plan: {
    files: Array<{ path: string; content: string }>;
    edits?: Array<{ path: string; search: string; replace: string }>;
    deletes: string[];
  }
) {
  if (baseDir !== targetDir) {
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    if (baseDir) {
      await cp(baseDir, targetDir, {
        recursive: true,
        filter: (src: string) =>
          !/(node_modules|\/\.npm(\/|$)|\/\.cache(\/|$))/.test(src),
      });
    }
  }
  for (const f of plan.files) {
    const dest = path.join(targetDir, f.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf8");
  }
  for (const e of plan.edits ?? []) {
    const dest = path.join(targetDir, e.path);
    let current: string;
    try {
      current = await readFile(dest, "utf8");
    } catch {
      throw new Error(`EDIT 目标文件不存在：${e.path}`);
    }
    const next = applySearchReplace(current, e.search, e.replace);
    if (next === null) {
      throw new Error(
        `EDIT 失败：在 ${e.path} 中找不到 SEARCH 片段（需与现有文件逐字符一致）。SEARCH 开头：\n${e.search.slice(0, 200)}`
      );
    }
    await writeFile(dest, next, "utf8");
  }
  for (const d of plan.deletes) {
    await rm(path.join(targetDir, d), { force: true });
  }
}

/** SEARCH/REPLACE 应用：精确 → 行尾空白容忍（未匹配行保持原样） */
function applySearchReplace(
  content: string,
  search: string,
  replace: string
): string | null {
  if (content.includes(search)) {
    return content.replace(search, replace);
  }
  const contentLines = content.split("\n");
  const searchLines = search.split("\n").map((l) => l.trimEnd());
  for (let i = 0; i + searchLines.length <= contentLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trimEnd() !== searchLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return [
        ...contentLines.slice(0, i),
        ...replace.split("\n"),
        ...contentLines.slice(i + searchLines.length),
      ].join("\n");
    }
  }
  return null;
}

/** 组装迭代上下文的「关键文件」：package.json 优先，其余按小文件优先，总量截断 */
export async function selectKeyFiles(
  dir: string,
  budgetBytes = 80 * 1024
): Promise<Array<{ path: string; content: string }>> {
  const tree = await readTree(dir);
  const out: Array<{ path: string; content: string }> = [];
  let used = 0;

  const priority = (p: string) =>
    p === "package.json" ? 0 : /\.(json|js|ts|html|css|md)$/.test(p) ? 1 : 2;
  const sorted = [...tree].sort(
    (a, b) => priority(a) - priority(b) || a.localeCompare(b)
  );

  for (const rel of sorted) {
    let content: string;
    try {
      content = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    const size = Buffer.byteLength(content, "utf8");
    if (used + size > budgetBytes) {
      if (rel === "package.json") {
        out.push({ path: rel, content: content.slice(0, budgetBytes) });
        used = budgetBytes;
      }
      continue;
    }
    used += size;
    out.push({ path: rel, content });
  }
  return out;
}
