import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

export type IsolationLevel = "process" | "container";

const NODE_BIN_DIR = (() => {
  const nodePath = process.execPath;
  return nodePath.slice(0, nodePath.lastIndexOf("/"));
})();

export function nodeBinDir(): string {
  return NODE_BIN_DIR;
}

/** 子进程 PATH：Node 运行时 + 系统基础路径（bash/timeout/coreutils） */
function sandboxPath(): string {
  return `${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin`;
}

async function dockerAvailable(): Promise<boolean> {
  return access("/var/run/docker.sock").then(
    () => true,
    () => false
  );
}

/** 当前隔离级别：RUNTIME_ISOLATION 显式指定 + Docker 可用性检测 */
export async function isolationLevel(): Promise<{
  level: IsolationLevel;
  degraded: boolean;
}> {
  const requested = process.env.RUNTIME_ISOLATION === "container";
  if (requested) {
    if (await dockerAvailable()) return { level: "container", degraded: false };
    return { level: "process", degraded: true };
  }
  return { level: "process", degraded: false };
}

export function isolationNotice(level: IsolationLevel, degraded: boolean) {
  if (level === "container") return "隔离级别：container（Docker 容器隔离）";
  return degraded
    ? "隔离级别：process（降级 —— 请求 container 但未检测到 Docker；演示级隔离，非生产环境）"
    : "隔离级别：process（演示级隔离，非生产环境）";
}

export type ExecResult = { code: number; timedOut: boolean };

/**
 * 进程级受限执行：净化环境（不含宿主业务配置）、独立 cwd、内存/时长限制、日志流式回传。
 * 容器级执行在部署环境提供 Docker 时接入（同一接口）。
 */
export function execSandboxed(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    timeoutMs: number;
    memoryMB?: number;
    env?: Record<string, string>;
    onLog?: (line: string) => void;
  }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const childEnv: Record<string, string> = {
      PATH: sandboxPath(),
      HOME: opts.cwd,
      LANG: "C.UTF-8",
      NODE_ENV: "production",
      ...opts.env,
    };

    const bashArgs = [
      "-c",
      [
        opts.memoryMB ? `ulimit -v $(( ${opts.memoryMB} * 1024 ))` : "",
        `timeout ${Math.ceil(opts.timeoutMs / 1000)} ${command} ${args.join(" ")}`,
      ]
        .filter(Boolean)
        .join("; "),
    ];

    const child = spawn("bash", bashArgs, {
      cwd: opts.cwd,
      env: childEnv as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    const pump = (stream: NodeJS.ReadableStream, tag: string) => {
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.trim()) opts.onLog?.(`${tag}${line}`);
        }
      });
    };
    pump(child.stdout, "");
    pump(child.stderr, "");

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs + 2000);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, timedOut });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, timedOut });
    });
  });
}

/** 后台长驻运行（构建验证/运行时管理器用）：独立进程组，便于整组终止 */
export function spawnRuntime(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env?: Record<string, string>;
    onLog?: (line: string) => void;
  }
) {
  const childEnv: Record<string, string> = {
    PATH: sandboxPath(),
    HOME: opts.cwd,
    LANG: "C.UTF-8",
    NODE_ENV: "production",
    ...opts.env,
  };
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: childEnv as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const pump = (stream: NodeJS.ReadableStream) => {
    stream.setEncoding("utf8");
    let buf = "";
    stream.on("data", (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) opts.onLog?.(line);
      }
    });
  };
  pump(child.stdout);
  pump(child.stderr);
  child.unref();
  return child;
}
