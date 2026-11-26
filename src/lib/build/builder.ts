import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  execSandboxed,
  isolationLevel,
  isolationNotice,
  startRuntime,
  stopRuntime,
  type IsolationLevel,
  type RuntimeHandle,
} from "./executor";
import { waitForPort, pickFreePort } from "../ports";
import { readManifest, type ModuleManifest } from "./manifest";
import {
  formatViolations,
  validateStructure,
  type Violation,
} from "./structure";

const INSTALL_TIMEOUT = 10 * 60 * 1000;
const BUILD_TIMEOUT = 5 * 60 * 1000;
const START_TIMEOUT = 45 * 1000;

/**
 * 错误摘要：从全量日志提取关键错误行（Cannot find module / 404 / Error …），再附尾部。
 * 纯尾部截断会被堆栈帧淹没病因（曾导致修复轮盲修：express 缺失 5 轮未发现）。
 */
function summarizeErrors(logs: string[], maxLines = 25): string {
  const INTERESTING =
    /(cannot find|Cannot find|module not found|Cannot resolve|SyntaxError|ReferenceError|TypeError|ENOENT|EADDRINUSE|EACCES|npm ERR|Error:|error TS|不可达|不存在|未声明|failed|失败|404)/;
  const hits: string[] = [];
  for (const raw of logs) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\s+at /.test(line) || /^0x[0-9a-f]+/i.test(line)) continue;
    if (/^\[syntax\]\s+\d+:/.test(line)) continue;
    if (INTERESTING.test(line)) {
      const short = line.slice(0, 300);
      if (!hits.includes(short)) hits.push(short);
    }
    if (hits.length >= maxLines) break;
  }
  const tailRaw = logs.join("\n").slice(-1200);
  return hits.length > 0
    ? `${hits.join("\n")}\n…（日志尾部）…\n${tailRaw}`
    : tailRaw;
}

/** 入口 HTML 静态链接完整性：引用的本地资源必须在工程内真实存在（防止计划与内容不一致） */
async function checkEntryLinks(dir: string): Promise<string | null> {
  const { readTree } = await import("./snapshot");
  let files: string[] = [];
  try {
    files = await readTree(dir);
  } catch {
    return null;
  }
  const fileSet = new Set(files);
  const htmlFiles = files.filter((f) => f.endsWith(".html")).slice(0, 3);
  const missing: string[] = [];
  const refRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const html of htmlFiles) {
    let content: string;
    try {
      content = await readFile(path.join(dir, html), "utf8");
    } catch {
      continue;
    }
    const htmlDir = path.posix.dirname(html);
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(content)) !== null) {
      let u = m[1].trim();
      if (!u || u.startsWith("#") || u.startsWith("data:") || u.startsWith("mailto:")) continue;
      if (/^https?:\/\//i.test(u) || /^\/\//.test(u)) continue;
      u = u.split("?")[0];
      if (!/\.[A-Za-z0-9]+$/.test(u)) continue; // 只校验文件类引用
      const resolved = u.startsWith("/")
        ? u.slice(1)
        : path.posix.normalize(path.posix.join(htmlDir, u));
      if (!fileSet.has(resolved)) {
        missing.push(`${html} → ${u}（解析为 ${resolved}）`);
      }
    }
  }
  if (missing.length === 0) return null;
  return `入口 HTML 引用了不存在的资源文件：\n${missing.slice(0, 10).join("\n")}\n（请用 ### FILE 输出缺失文件，或修正引用路径；路径相对于 HTML 所在目录）`;
}

/** 依赖一致性：外部包必须在 package.json 声明；相对引用必须有对应文件 */
async function validateDependencies(dir: string): Promise<string | null> {
  const { readTree } = await import("./snapshot");
  const { builtinModules } = await import("node:module");
  let files: string[] = [];
  try {
    files = await readTree(dir);
  } catch {
    return null;
  }
  const fileSet = new Set(files);
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } = {};
  try {
    pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const builtins = new Set(
    builtinModules.map((m) => (m.startsWith("node:") ? m.slice(5) : m))
  );

  const missingDeps = new Set<string>();
  const missingLocals = new Set<string>();
  const specRe =
    /require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const rel of files.filter((f) => /\.(js|mjs|cjs)$/.test(f))) {
    let content: string;
    try {
      content = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = specRe.exec(content)) !== null) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        const base = path.posix.normalize(
          path.posix.join(path.posix.dirname(rel), spec)
        );
        const candidates = [
          base,
          `${base}.js`,
          `${base}.mjs`,
          `${base}.cjs`,
          `${base}.json`,
          `${base}/index.js`,
        ];
        if (!candidates.some((c) => fileSet.has(c))) {
          missingLocals.add(`${rel} → ${spec}`);
        }
      } else {
        const root = spec.startsWith("@")
          ? spec.split("/").slice(0, 2).join("/")
          : spec.split("/")[0];
        if (builtins.has(root)) continue;
        if (!declared.has(root)) missingDeps.add(`${rel} → ${root}`);
      }
    }
  }

  if (missingDeps.size === 0 && missingLocals.size === 0) return null;
  const parts: string[] = [];
  if (missingDeps.size > 0) {
    parts.push(
      `代码引用了未声明的第三方包（运行时会 Cannot find module）：${[...missingDeps].slice(0, 8).join("；")}。请把包加入 package.json 的 dependencies，或改用 Node 内置模块实现。`
    );
  }
  if (missingLocals.size > 0) {
    parts.push(
      `引用了不存在的本地模块：${[...missingLocals].slice(0, 8).join("；")}。请输出缺失文件或修正路径。`
    );
  }
  return `依赖一致性检查失败：${parts.join(" | ")}`;
}

async function hasScript(dir: string, name: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    return Boolean(pkg?.scripts?.[name]);
  } catch {
    return false;
  }
}

/**
 * 语法校验：所有 .js 用容器内 `node --check`；所有 .json 做解析校验。
 * 一次容器启动批量检查，避免每个文件启动一个容器；文件名以 argv 传递，不拼 shell。
 */
async function validateSyntax(
  dir: string,
  log: (line: string) => void,
  isolation: IsolationLevel
): Promise<string | null> {
  const { readTree } = await import("./snapshot");
  let files: string[] = [];
  try {
    files = await readTree(dir);
  } catch {
    return "无法读取工程文件";
  }

  for (const rel of files.filter((f) => f.endsWith(".json")).slice(0, 50)) {
    try {
      JSON.parse(await readFile(path.join(dir, rel), "utf8"));
    } catch (err) {
      return `${rel} 不是合法的 JSON（可能被截断）：${err instanceof Error ? err.message : ""}`;
    }
  }

  const jsFiles = files
    .filter((f) => /\.(js|mjs|cjs)$/.test(f))
    .slice(0, 100);
  if (jsFiles.length === 0) {
    log(`[build] 语法校验通过（${files.length} 个文件，无脚本）`);
    return null;
  }

  const checker = [
    'const { spawnSync } = require("node:child_process");',
    'const fs = require("node:fs");',
    "const bad = [];",
    "for (const f of process.argv.slice(1)) {",
    "  let src = \"\";",
    "  try { src = fs.readFileSync(f, \"utf8\"); }",
    "  catch (e) { bad.push(`${f}\\n${e.message}`); continue; }",
    "  const isEsm = f.endsWith(\".mjs\") || /^\\s*(?:import|export)\\s/m.test(src);",
    "  const args = isEsm ? [\"--input-type=module\", \"--check\"] : [\"--check\", f];",
    "  const r = spawnSync(process.execPath, args, { encoding: \"utf8\", input: isEsm ? src : undefined });",
    "  if (r.status !== 0) bad.push(`${f}\\n${(r.stderr || \"\").slice(-600)}`);",
    "}",
    "if (bad.length) { console.error(bad.join(\"\\n\")); process.exit(1); }",
  ].join("\n");

  const out: string[] = [];
  const result = await execSandboxed("node", ["-e", checker, ...jsFiles], {
    cwd: dir,
    timeoutMs: 60_000,
    isolation,
    onLog: (l) => {
      out.push(l);
      log(`[syntax] ${l}`);
    },
  });
  if (result.code !== 0) {
    const detail = out.join("\n").slice(-2000) || result.error || "node --check 失败";
    return `JS 语法错误（文件可能被截断或不完整）：\n${detail}`;
  }
  log(`[build] 语法校验通过（${files.length} 个文件）`);
  return null;
}

/** L3 冒烟检查：首页可返回 + HTML 引用的每个前端资源真实可达（防断链/截断产物） */
async function runAssetChecks(
  base: string,
  log: (line: string) => void
): Promise<string | null> {
  const origin = new URL(base).origin;
  let html: string;
  try {
    const res = await fetch(origin + "/", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return `首页请求失败（server.js 可能有启动或路由错误）：HTTP ${res.status}`;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) {
      log("[smoke] 首页非 HTML（API 型项目），跳过资源检查");
      return null;
    }
    html = await res.text();
  } catch (err) {
    return `首页请求异常（server.js 可能有启动错误）：${err instanceof Error ? err.message : ""}`;
  }

  const refs = new Set<string>();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = m[1].trim();
    if (!u || u.startsWith("#") || u.startsWith("data:") || u.startsWith("mailto:")) {
      continue;
    }
    if (/^https?:\/\//i.test(u)) {
      log(`[smoke] 警告：外链资源（运行契约禁止）：${u.slice(0, 100)}`);
      continue;
    }
    refs.add(u);
    if (refs.size >= 20) break;
  }

  const failures: string[] = [];
  for (const u of refs) {
    try {
      const target = new URL(u, origin + "/");
      if (target.origin !== origin) continue;
      const res = await fetch(target.toString(), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) failures.push(`${u} -> HTTP ${res.status}`);
    } catch {
      failures.push(`${u} -> 请求失败`);
    }
  }
  if (failures.length > 0) {
    return `前端资源不可达（server.js 静态文件服务路径错误或文件缺失——优先检查 server.js 中静态路径是否用 path.join(__dirname, 'public', req.url) 而非 '.' + req.url；path.resolve 必须基于 __dirname 而非 CWD）：${failures.join("; ")}`;
  }
  log(`[smoke] 资源冒烟通过（${refs.size} 个引用全部可达）`);
  return null;
}

export type BuildOutcome = {
  ok: boolean;
  logs: string[];
  errorTail: string;
  startValidated: boolean;
  violations?: Violation[];
};

/**
 * 沙箱构建：结构门禁 → 语法校验 → 依赖安装 → 构建 → 启动验证。
 * container 模式下所有命令在 Docker 内执行；process 模式仅限本地开发显式使用。
 */
export async function runSandboxedBuild(
  dir: string,
  onLog: (line: string) => void,
  opts: {
    structureMode?: "strict" | "advisory";
    manifest?: ModuleManifest | null;
    isolation?: IsolationLevel;
  } = {}
): Promise<BuildOutcome> {
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
    onLog(line);
  };

  const iso = opts.isolation
    ? { level: opts.isolation, degraded: false }
    : await isolationLevel();
  const isolation = iso.level;
  log(isolationNotice(isolation, iso.degraded, "Docker 不可用"));

  // 0) 结构门禁（确定性，先于 install）
  const manifest = opts.manifest ?? (await readManifest(dir));
  const structure = await validateStructure(dir, { manifest });
  for (const v of structure.violations) {
    log(`[structure] ${v.severity === "error" ? "错误" : "警告"} ${formatViolations([v])}`);
  }
  if (structure.violations.length === 0) {
    log("[structure] 结构门禁通过");
  }
  if (opts.structureMode !== "advisory" && structure.errors.length > 0) {
    return {
      ok: false,
      logs,
      errorTail: formatViolations(structure.errors),
      startValidated: false,
      violations: structure.errors,
    };
  }

  // 1) 语法校验（防截断/损坏产物）
  const syntaxError = await validateSyntax(dir, log, isolation);
  if (syntaxError) {
    return { ok: false, logs, errorTail: syntaxError, startValidated: false };
  }

  // 1.5) 静态完整性门禁：入口资源存在性 + 依赖一致性（确定性、先于安装）
  const entryLinksError = await checkEntryLinks(dir);
  if (entryLinksError) {
    log(`[links] ${entryLinksError.split("\n")[0]}`);
    return { ok: false, logs, errorTail: entryLinksError, startValidated: false };
  }
  const depsError = await validateDependencies(dir);
  if (depsError) {
    log(`[deps] ${depsError.split("。")[0]}`);
    return { ok: false, logs, errorTail: depsError, startValidated: false };
  }
  log("[build] 静态完整性（链接/依赖）通过");

  // 2) npm install
  log("[build] npm install 开始");
  const install = await execSandboxed(
    "npm",
    ["install", "--no-audit", "--no-fund"],
    {
      cwd: dir,
      timeoutMs: INSTALL_TIMEOUT,
      memoryMB: 2048,
      isolation,
      onLog: (l) => log(`[install] ${l}`),
    }
  );
  if (install.code !== 0) {
    if (install.error) log(`[install] ${install.error}`);
    return {
      ok: false,
      logs,
      errorTail: install.error ?? summarizeErrors(logs),
      startValidated: false,
    };
  }
  log("[build] npm install 完成");

  // 3) npm run build（无脚本则跳过）
  if (await hasScript(dir, "build")) {
    log("[build] npm run build 开始");
    const build = await execSandboxed("npm", ["run", "build"], {
      cwd: dir,
      timeoutMs: BUILD_TIMEOUT,
      memoryMB: 2048,
      isolation,
      env: { NODE_ENV: "production" },
      onLog: (l) => log(`[build] ${l}`),
    });
    if (build.code !== 0) {
      if (build.error) log(`[build] ${build.error}`);
      return { ok: false, logs, errorTail: build.error ?? summarizeErrors(logs), startValidated: false };
    }
    log("[build] npm run build 完成");
  } else {
    log("[build] 无 build 脚本，跳过");
  }

  // 4) 启动验证 + 资源冒烟
  const port = isolation === "process" ? await pickFreePort() : 3000;
  log(`[build] 启动验证（隔离=${isolation}，PORT=${port}）`);
  let handle: RuntimeHandle | null = null;
  try {
    handle = await startRuntime("npm", ["start"], {
      cwd: dir,
      port,
      env: { PORT: String(port) },
      isolation,
      onLog: (l) => log(`[start] ${l}`),
      name: `atoms-verify-${process.pid}-${Date.now()}`,
    });
    const ready = await waitForPort(handle.host, handle.port, START_TIMEOUT);
    if (!ready) {
      log("[build] 启动验证失败：端口未在超时内就绪");
      return { ok: false, logs, errorTail: summarizeErrors(logs), startValidated: false };
    }
    log("[build] 启动验证通过");

    const smokeError = await runAssetChecks(
      `http://${handle.host}:${handle.port}`,
      log
    );
    if (smokeError) {
      log(`[smoke] ${smokeError}`);
      return {
        ok: false,
        logs,
        errorTail: summarizeErrors(logs),
        startValidated: true,
      };
    }
    return { ok: true, logs, errorTail: "", startValidated: true };
  } finally {
    if (handle) await stopRuntime(handle).catch(() => undefined);
  }
}

function tail(logs: string[], maxChars = 4000): string {
  const joined = logs.join("\n");
  return joined.length > maxChars
    ? joined.slice(joined.length - maxChars)
    : joined;
}

/** 从错误尾部提取涉及的文件路径（供修复上下文） */
export function extractFileHints(errorTail: string, tree: string[]): string[] {
  const hints = new Set<string>();
  for (const file of tree) {
    if (errorTail.includes(file)) hints.add(file);
  }
  return [...hints].slice(0, 10);
}