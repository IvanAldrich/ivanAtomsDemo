import path from "node:path";
import { isCodeFile, isManifestPath } from "./file-kinds";

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
 *   ### NEED: relative/path/to/file      ← 请求平台补充上下文（迭代轮，最多追加两轮）
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
  needs: string[];
  preamble: string;
};

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_CODE_FILE_BYTES = 16 * 1024;
export const MAX_NEED_ROUNDS = 2;
const NEED_HEADER_RE = /^### NEED:\s*(.+?)\s*$/gm;

export function parseGenerationPlan(raw: string): GenerationPlan {
  const files: Array<{ path: string; content: string }> = [];
  const edits: Array<{ path: string; search: string; replace: string }> = [];
  const deletes: string[] = [];
  const needs: string[] = [];
  let preamble = "";

  const headerRe = /^### (FILE|EDIT|DELETE|NEED):\s*(.+?)\s*$/gm;
  const matches: Array<{
    kind: "FILE" | "EDIT" | "DELETE" | "NEED";
    path: string;
    index: number;
    end: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(raw)) !== null) {
    matches.push({
      kind: m[1] as "FILE" | "EDIT" | "DELETE" | "NEED",
      path: m[2],
      index: m.index,
      end: headerRe.lastIndex,
    });
  }
  if (matches.length === 0) {
    return { files, edits, deletes, needs, preamble: raw.slice(0, 4000) };
  }
  preamble = raw.slice(0, matches[0].index).trim().slice(0, 2000);

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const body = raw.slice(cur.end, next ? next.index : undefined).trim();
    if (cur.kind === "NEED") {
      needs.push(cur.path);
      continue;
    }
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
    let content = fence ? fence[1] : body;
    // 清洗「独立成行」的多余围栏（续写/双重包裹污染；内联围栏仍由 validatePlan 拦截）
    if (!/\.(md|markdown|txt)$/i.test(cur.path)) {
      content = content.replace(/^[ \t]*```[A-Za-z0-9_+-]*[ \t]*\r?$/gm, "");
      if (content !== (fence ? fence[1] : body)) {
        content = content.replace(/\n{3,}/g, "\n\n").trim();
      }
    }
    files.push({ path: cur.path, content });
  }

  return { files, edits, deletes, needs, preamble };
}

/** 从模型原始输出中提取 NEED 路径（用于迭代轮补充上下文） */
export function extractNeedPaths(raw: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  NEED_HEADER_RE.lastIndex = 0;
  while ((m = NEED_HEADER_RE.exec(raw)) !== null) {
    const p = m[1].trim();
    if (isValidPath(p) && !out.includes(p)) out.push(p);
    if (out.length >= 5) break;
  }
  return out;
}

export class ProtocolError extends Error {}

/** 校验计划：路径合法、必需文件、数量与大小上限 */
export function validatePlan(
  plan: GenerationPlan,
  opts: { requirePackageJson: boolean; maxCodeFileKB?: number }
): void {
  const seen = new Set<string>();
  let total = 0;
  const maxCodeBytes = (opts.maxCodeFileKB ?? MAX_CODE_FILE_BYTES / 1024) * 1024;

  for (const f of plan.files) {
    if (!isValidPath(f.path)) {
      throw new ProtocolError(`非法文件路径：${f.path}`);
    }
    if (isManifestPath(f.path)) {
      throw new ProtocolError("Module Manifest 由平台管理，禁止模型直接写入");
    }
    if (
      isCodeFile(f.path) &&
      /```(?:javascript|js|css|html|json|typescript|ts|bash|sh)\b/i.test(f.content)
    ) {
      throw new ProtocolError(
        `文件内容包含 Markdown 代码围栏，可能被续写污染：${f.path}`
      );
    }
    if (seen.has(f.path)) {
      throw new ProtocolError(`重复文件：${f.path}`);
    }
    seen.add(f.path);
    const bytes = Buffer.byteLength(f.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new ProtocolError(`文件过大（>512KB）：${f.path}`);
    }
    if (isCodeFile(f.path) && bytes > maxCodeBytes) {
      throw new ProtocolError(
        `文件超过模块预算（${Math.round(bytes / 1024)}KB > ${Math.round(
          maxCodeBytes / 1024
        )}KB）：${f.path}。请按职责拆分后再输出。`
      );
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
    if (isManifestPath(e.path)) {
      throw new ProtocolError("Module Manifest 由平台管理，禁止模型直接编辑");
    }
    if (!e.search.trim()) {
      throw new ProtocolError(`EDIT 的 SEARCH 片段为空：${e.path}`);
    }
    if (plan.edits.length > MAX_FILES * 4) {
      throw new ProtocolError(`EDIT 数量超过上限`);
    }
  }
  for (const need of plan.needs) {
    if (!isValidPath(need)) {
      throw new ProtocolError(`非法的 NEED 路径：${need}`);
    }
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new ProtocolError(`工程总大小超过 8MB`);
  }
  for (const d of plan.deletes) {
    if (!isValidPath(d)) {
      throw new ProtocolError(`非法删除路径：${d}`);
    }
    if (isManifestPath(d)) {
      throw new ProtocolError("Module Manifest 由平台管理，禁止模型删除");
    }
    if (seen.has(d)) {
      throw new ProtocolError(
        `同一文件同时出现 FILE 与 DELETE：${d}。重写请只用 FILE，删除请不要再输出该文件内容`
      );
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
  // 生成工程的路径只允许 ASCII 安全字符，避免模型把说明文字写进文件名
  if (!/^[A-Za-z0-9._\-\/]+$/.test(p)) return false;
  const norm = path.normalize(p);
  if (norm.startsWith("..") || norm === ".") return false;
  return !norm.split(path.sep).some((seg) => seg === "..");
}
