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

/** 快照 GC：仅保留最新 N 个版本目录（防止磁盘无界增长） */
export async function gcSnapshots(projectId: string, keep = 3): Promise<number> {
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
  const versions = entries
    .map((e) => ({ name: e, n: Number(/^v(\d+)$/.exec(e)?.[1] ?? NaN) }))
    .filter((v) => Number.isInteger(v.n))
    .sort((a, b) => b.n - a.n);
  let removed = 0;
  for (const v of versions.slice(keep)) {
    await rm(path.join(snapshotsRoot, v.name), { recursive: true, force: true });
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
        if (["node_modules", ".git", ".npm", ".cache"].includes(e.name)) continue;
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
 * 基线与目标相同（原地修复）时不做清空，仅应用写入/删除。
 */
export async function writeSnapshot(
  baseDir: string | null,
  targetDir: string,
  plan: { files: Array<{ path: string; content: string }>; deletes: string[] }
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
  for (const d of plan.deletes) {
    await rm(path.join(targetDir, d), { force: true });
  }
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
