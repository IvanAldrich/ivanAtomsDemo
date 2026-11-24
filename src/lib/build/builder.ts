import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { execSandboxed, spawnRuntime } from "./executor";
import { waitForPort } from "@/lib/ports";

const INSTALL_TIMEOUT = 10 * 60 * 1000;
const BUILD_TIMEOUT = 5 * 60 * 1000;
const START_TIMEOUT = 45 * 1000;

async function hasScript(dir: string, name: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    return Boolean(pkg?.scripts?.[name]);
  } catch {
    return false;
  }
}

/** 语法校验：所有 .js 用 node --check；所有 .json 做解析校验（防止截断/损坏的产物通过构建） */
async function validateSyntax(
  dir: string,
  log: (line: string) => void
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

  for (const rel of files.filter((f) => /\.(js|mjs|cjs)$/.test(f)).slice(0, 100)) {
    // 注意：node/V8 启动需要较大虚拟地址空间，语法检查不能施加 ulimit -v
    const out: string[] = [];
    const result = await execSandboxed("node", ["--check", rel], {
      cwd: dir,
      timeoutMs: 15000,
      onLog: (l) => {
        out.push(l);
        log(`[syntax] ${l}`);
      },
    });
    if (result.code !== 0) {
      const detail = out.join("\n").slice(-800) || "node --check 失败";
      return `${rel} 语法错误（文件可能被截断或不完整）：\n${detail}`;
    }
  }
  log(`[build] 语法校验通过（${files.length} 个文件）`);
  return null;
}

/** L3 冒烟检查：首页可返回 + HTML 引用的每个前端资源真实可达（防断链/截断产物） */
async function runAssetChecks(
  port: number,
  log: (line: string) => void
): Promise<string | null> {
  const base = `http://127.0.0.1:${port}`;
  let html: string;
  try {
    const res = await fetch(base + "/", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return `首页请求失败：HTTP ${res.status}`;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) {
      log("[smoke] 首页非 HTML（API 型项目），跳过资源检查");
      return null;
    }
    html = await res.text();
  } catch (err) {
    return `首页请求异常：${err instanceof Error ? err.message : ""}`;
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
      const target = new URL(u, base + "/");
      if (target.host !== `127.0.0.1:${port}`) continue;
      const res = await fetch(target.toString(), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) failures.push(`${u} -> HTTP ${res.status}`);
    } catch {
      failures.push(`${u} -> 请求失败`);
    }
  }
  if (failures.length > 0) {
    return `前端资源不可达（页面引用了不存在或损坏的文件）：${failures.join("; ")}`;
  }
  log(`[smoke] 资源冒烟通过（${refs.size} 个引用全部可达）`);
  return null;
}

export type BuildOutcome = {
  ok: boolean;
  logs: string[];
  errorTail: string;
  startValidated: boolean;
};

/**
 * 沙箱构建：依赖安装 → 构建（如有）→ 启动验证（npm start + 端口就绪探测）。
 * 全部输出流式回传；失败时返回错误尾部供自修复。
 */
export async function runSandboxedBuild(
  dir: string,
  onLog: (line: string) => void
): Promise<BuildOutcome> {
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
    onLog(line);
  };

  // 0) 语法校验（防截断/损坏产物）
  const syntaxError = await validateSyntax(dir, log);
  if (syntaxError) {
    return { ok: false, logs, errorTail: syntaxError, startValidated: false };
  }

  // 1) npm install
  log("[build] npm install 开始");
  const install = await execSandboxed("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: dir,
    timeoutMs: INSTALL_TIMEOUT,
    memoryMB: 2048,
    onLog: (l) => log(`[install] ${l}`),
  });
  if (install.code !== 0) {
    return {
      ok: false,
      logs,
      errorTail: tail(logs),
      startValidated: false,
    };
  }
  log("[build] npm install 完成");

  // 2) npm run build（无脚本则跳过）
  if (await hasScript(dir, "build")) {
    log("[build] npm run build 开始");
    const build = await execSandboxed("npm", ["run", "build"], {
      cwd: dir,
      timeoutMs: BUILD_TIMEOUT,
      memoryMB: 2048,
      env: { NODE_ENV: "production" },
      onLog: (l) => log(`[build] ${l}`),
    });
    if (build.code !== 0) {
      return { ok: false, logs, errorTail: tail(logs), startValidated: false };
    }
    log("[build] npm run build 完成");
  } else {
    log("[build] 无 build 脚本，跳过");
  }

  // 3) 启动验证：npm start + 端口就绪 + 首页可达探测
  const port = 43000 + Math.floor(Math.random() * 500);
  log(`[build] 启动验证（PORT=${port}）`);
  const child = spawnRuntime("npm", ["start"], {
    cwd: dir,
    env: { PORT: String(port) },
    onLog: (l) => log(`[start] ${l}`),
  });
  const ready = await waitForPort("127.0.0.1", port, START_TIMEOUT);
  if (!ready) {
    killTree(child);
    log("[build] 启动验证失败：端口未在超时内就绪");
    return { ok: false, logs, errorTail: tail(logs), startValidated: false };
  }
  log("[build] 启动验证通过");

  // L3 冒烟：真实请求首页与全部前端资源引用
  const smokeError = await runAssetChecks(port, log);
  killTree(child);
  if (smokeError) {
    log(`[smoke] ${smokeError}`);
    return {
      ok: false,
      logs,
      errorTail: tail(logs),
      startValidated: true,
    };
  }
  return { ok: true, logs, errorTail: "", startValidated: true };
}

export function killTree(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
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
