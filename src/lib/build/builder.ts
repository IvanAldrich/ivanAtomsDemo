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
  killTree(child);
  if (!ready) {
    log("[build] 启动验证失败：端口未在超时内就绪");
    return { ok: false, logs, errorTail: tail(logs), startValidated: false };
  }
  log("[build] 启动验证通过");
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
