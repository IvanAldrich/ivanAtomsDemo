import path from "node:path";

/**
 * 自由生成的文件输出协议（模型输出格式）：
 *
 *   ### FILE: relative/path/to/file      ← 整文件（新增/大重构）
 *   ```lang
 *   文件完整内容
 *   ```
 *
 *   ### EDIT: relative/path/to/file      ← 增量修改（迭代首选）
 *   <<<<<<< SEARCH
 *   旧代码片段（必须与现有文件逐字符匹配）
 *   =======
 *   新代码片段
 *   >>>>>>> REPLACE
 *
 *   ### DELETE: relative/path/to/file    ← 删除文件
 *
 * 未提及的文件保持不变（迭代轮）。解析器容忍围栏外的说明文字。
 */

export type FileOp =
  | { op: "write"; path: string; content: string }
  | { op: "edit"; path: string; search: string; replace: string }
  | { op: "delete"; path: string };

export type GenerationPlan = {
  files: Array<{ path: string; content: string }>;
  edits: Array<{ path: string; search: string; replace: string }>;
  deletes: string[];
  preamble: string;
};

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export function parseGenerationPlan(raw: string): GenerationPlan {
  const files: Array<{ path: string; content: string }> = [];
  const edits: Array<{ path: string; search: string; replace: string }> = [];
  const deletes: string[] = [];
  let preamble = "";

  const headerRe = /^### (FILE|EDIT|DELETE):\s*(.+?)\s*$/gm;
  const matches: Array<{
    kind: "FILE" | "EDIT" | "DELETE";
    path: string;
    index: number;
    end: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(raw)) !== null) {
    matches.push({
      kind: m[1] as "FILE" | "EDIT" | "DELETE",
      path: m[2],
      index: m.index,
      end: headerRe.lastIndex,
    });
  }
  if (matches.length === 0) {
    return { files, edits, deletes, preamble: raw.slice(0, 4000) };
  }
  preamble = raw.slice(0, matches[0].index).trim().slice(0, 2000);

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const body = raw.slice(cur.end, next ? next.index : undefined).trim();
    if (cur.kind === "DELETE") {
      deletes.push(cur.path);
      continue;
    }
    if (cur.kind === "EDIT") {
      const editRe =
        /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
      let e: RegExpExecArray | null;
      let found = false;
      while ((e = editRe.exec(body)) !== null) {
        edits.push({ path: cur.path, search: e[1], replace: e[2] });
        found = true;
      }
      if (!found) {
        throw new ProtocolError(
          `EDIT 块缺少 SEARCH/REPLACE 结构：${cur.path}（应使用 <<<<<<< SEARCH … ======= … >>>>>>> REPLACE）`
        );
      }
      continue;
    }
    // 内容：优先取围栏代码块；无围栏时取原文（容忍模型省略围栏）
    const fence = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(body);
    const content = fence ? fence[1] : body;
    files.push({ path: cur.path, content });
  }

  return { files, edits, deletes, preamble };
}

export class ProtocolError extends Error {}

/** 校验计划：路径合法、必需文件、数量与大小上限 */
export function validatePlan(
  plan: GenerationPlan,
  opts: { requirePackageJson: boolean }
): void {
  const seen = new Set<string>();
  let total = 0;

  for (const f of plan.files) {
    if (!isValidPath(f.path)) {
      throw new ProtocolError(`非法文件路径：${f.path}`);
    }
    if (seen.has(f.path)) {
      throw new ProtocolError(`重复文件：${f.path}`);
    }
    seen.add(f.path);
    const bytes = Buffer.byteLength(f.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new ProtocolError(`文件过大（>512KB）：${f.path}`);
    }
    total += bytes;
    if (plan.files.length > MAX_FILES) {
      throw new ProtocolError(`文件数量超过上限 ${MAX_FILES}`);
    }
  }
  for (const e of plan.edits) {
    if (!isValidPath(e.path)) {
      throw new ProtocolError(`非法编辑路径：${e.path}`);
    }
    if (!e.search.trim()) {
      throw new ProtocolError(`EDIT 的 SEARCH 片段为空：${e.path}`);
    }
    if (plan.edits.length > MAX_FILES * 4) {
      throw new ProtocolError(`EDIT 数量超过上限`);
    }
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new ProtocolError(`工程总大小超过 8MB`);
  }
  for (const d of plan.deletes) {
    if (!isValidPath(d)) {
      throw new ProtocolError(`非法删除路径：${d}`);
    }
  }
  if (opts.requirePackageJson && !plan.files.some((f) => f.path === "package.json")) {
    throw new ProtocolError(
      "工程缺少 package.json（需包含 name/scripts.start/dependencies）"
    );
  }
}

export function isValidPath(p: string): boolean {
  if (!p || p.includes("\0")) return false;
  if (path.isAbsolute(p)) return false;
  const norm = path.normalize(p);
  if (norm.startsWith("..") || norm === ".") return false;
  return !norm.split(path.sep).some((seg) => seg === "..");
}
