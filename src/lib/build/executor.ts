import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";

export type IsolationLevel = "process" | "container";

const DOCKER_BIN = process.env.DOCKER_BIN ?? "/usr/bin/docker";
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "node:22-bookworm";
const BUILD_NETWORK = process.env.SANDBOX_BUILD_NETWORK ?? "atoms-build";
const RUNTIME_NETWORK = process.env.SANDBOX_RUNTIME_NETWORK ?? "atoms-runtime";
const SANDBOX_MEMORY_MB = Number(process.env.SANDBOX_MEMORY_MB ?? 2048) || 2048;
const SANDBOX_PIDS_LIMIT = Number(process.env.SANDBOX_PIDS_LIMIT ?? 512) || 512;
const SANDBOX_CPUS = process.env.SANDBOX_CPUS ?? "2";

/** 容器用户跟随宿主 UID/GID，保证挂载的工作目录可写；宿主为 root 时回退到 1000，避免容器以 root 运行 */
function defaultSandboxUser(): string {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return `${uid > 0 ? uid : 1000}:${gid > 0 ? gid : 1000}`;
}

const SANDBOX_USER = process.env.SANDBOX_USER ?? defaultSandboxUser();
const INSTANCE_LABEL = `atoms.instance=${os.hostname().replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

const NODE_BIN_DIR = (() => {
  const nodePath = process.execPath;
  return nodePath.slice(0, nodePath.lastIndexOf("/"));
})();

export function nodeBinDir(): string {
  return NODE_BIN_DIR;
}

/** 子进程 PATH：Node 运行时 + 系统基础路径（bash/coreutils） */
function sandboxPath(): string {
  return `${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin`;
}

export type DockerStatus = { ok: boolean; version?: string; error?: string };

let dockerProbe: { at: number; status: DockerStatus } | null = null;
let imageReady = false;
let networkReady = false;
let buildNetworkReady = false;
let execSeq = 0;

function dockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    NODE_ENV: process.env.NODE_ENV ?? "development",
  };
  for (const key of ["DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

type ProcResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function runDocker(args: string[], timeoutMs: number): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(DOCKER_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: dockerEnv(),
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: `${stderr}${err.message}`,
        timedOut,
      });
    });
  });
}

/** 探测 Docker daemon 是否真的可用（不是只看 socket 文件是否存在） */
export async function dockerStatus(force = false): Promise<DockerStatus> {
  if (!force && dockerProbe && Date.now() - dockerProbe.at < 30_000) {
    return dockerProbe.status;
  }
  const res = await runDocker(["info", "--format", "{{.ServerVersion}}"], 8_000);
  const status: DockerStatus =
    res.code === 0
      ? { ok: true, version: res.stdout.trim() }
      : { ok: false, error: (res.stderr || "docker info failed").slice(-500) };
  dockerProbe = { at: Date.now(), status };
  return status;
}

export async function ensureSandboxImage(): Promise<void> {
  if (imageReady) return;
  const inspect = await runDocker(["image", "inspect", SANDBOX_IMAGE], 10_000);
  if (inspect.code !== 0) {
    const pull = await runDocker(["pull", SANDBOX_IMAGE], 10 * 60 * 1000);
    if (pull.code !== 0) {
      throw new Error(
        `沙箱镜像 ${SANDBOX_IMAGE} 不可用：${(pull.stderr || pull.stdout).slice(-800)}`
      );
    }
  }
  imageReady = true;
}

async function ensureNetwork(name: string, internal: boolean): Promise<void> {
  if (["bridge", "host", "none"].includes(name)) return;

  const inspect = await runDocker(["network", "inspect", name], 10_000);
  if (inspect.code === 0) return;

  const args = [
    "network",
    "create",
    ...(internal ? ["--internal"] : []),
    name,
  ];
  const create = await runDocker(args, 30_000);
  if (create.code !== 0 && !/already exists/i.test(create.stderr)) {
    throw new Error(`无法创建沙箱网络 ${name}：${create.stderr.slice(-500)}`);
  }
}

async function ensureRuntimeNetwork(): Promise<void> {
  if (networkReady) return;
  await ensureNetwork(RUNTIME_NETWORK, true);
  networkReady = true;
}

async function ensureBuildNetwork(): Promise<void> {
  if (buildNetworkReady) return;
  await ensureNetwork(BUILD_NETWORK, false);
  buildNetworkReady = true;
}

/** 当前隔离级别：显式请求 container 且 Docker 真实可用时才返回 container */
export async function isolationLevel(): Promise<{
  level: IsolationLevel;
  degraded: boolean;
  reason?: string;
}> {
  const requested = process.env.RUNTIME_ISOLATION === "container";
  if (!requested) return { level: "process", degraded: false };
  const status = await dockerStatus();
  if (status.ok) return { level: "container", degraded: false };
  return {
    level: "process",
    degraded: true,
    reason: status.error ?? "docker unavailable",
  };
}

export function isolationNotice(
  level: IsolationLevel,
  degraded: boolean,
  reason?: string
) {
  if (level === "container") {
    return `隔离级别：container（Docker ${os.hostname()}，非 root、只读 rootfs、cgroup 限额、独立网络）`;
  }
  return degraded
    ? `隔离级别：process（降级 —— 请求 container 但 Docker 不可用：${reason ?? "unknown"}；仅限本地开发）`
    : "隔离级别：process（显式选择，仅限本地开发）";
}

export type ExecResult = { code: number; timedOut: boolean; error?: string };

export type ExecOpts = {
  cwd: string;
  timeoutMs: number;
  memoryMB?: number;
  env?: Record<string, string>;
  onLog?: (line: string) => void;
  isolation?: IsolationLevel;
  network?: string;
  containerName?: string;
};

function pump(stream: NodeJS.ReadableStream, sink: (line: string) => void) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) sink(line);
    }
  });
  stream.on("end", () => {
    if (buf.trim()) sink(buf);
  });
}

function killProcessGroup(child: ChildProcess) {
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

function execEnv(opts: ExecOpts): NodeJS.ProcessEnv {
  return {
    PATH: sandboxPath(),
    HOME: opts.cwd,
    LANG: "C.UTF-8",
    NODE_ENV: "production",
    ...opts.env,
  } as NodeJS.ProcessEnv;
}

function execProcess(
  command: string,
  args: string[],
  opts: ExecOpts
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // 内存限制必须经过 shell；参数用位置参数传递，避免把 LLM 产物拼进 shell 字符串
    const useLimit = Boolean(opts.memoryMB);
    const child = spawn(
      useLimit ? "bash" : command,
      useLimit
        ? [
            "-c",
            'ulimit -v "$1"; shift; exec "$@"',
            "bash",
            String(Math.floor((opts.memoryMB ?? SANDBOX_MEMORY_MB) * 1024)),
            command,
            ...args,
          ]
        : args,
      {
        cwd: opts.cwd,
        env: execEnv(opts),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      }
    );
    if (child.stdout) pump(child.stdout, (l) => opts.onLog?.(l));
    if (child.stderr) pump(child.stderr, (l) => opts.onLog?.(l));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child);
    }, opts.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, timedOut, error: err.message });
    });
  });
}

function containerName(prefix: string, explicit?: string): string {
  if (explicit) return explicit.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  execSeq += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${execSeq}`;
}

function containerArgs(opts: {
  name: string;
  network: string;
  cwd: string;
  memoryMB?: number;
  env?: Record<string, string>;
  init?: boolean;
  remove?: boolean;
  detach?: boolean;
}): string[] {
  const args = [
    "run",
    ...(opts.detach ? ["--detach"] : []),
    ...(opts.remove ? ["--rm"] : []),
    ...(opts.init ? ["--init"] : []),
    "--name",
    opts.name,
    "--label",
    "atoms.managed=1",
    "--label",
    INSTANCE_LABEL,
    "--network",
    opts.network,
    "--user",
    SANDBOX_USER,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,size=512m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(SANDBOX_PIDS_LIMIT),
    "--memory",
    `${opts.memoryMB ?? SANDBOX_MEMORY_MB}m`,
    "--memory-swap",
    `${opts.memoryMB ?? SANDBOX_MEMORY_MB}m`,
    "--ulimit",
    "nofile=1024:2048",
    "--cpus",
    SANDBOX_CPUS,
    "-v",
    `${opts.cwd}:/app:rw`,
    "-w",
    "/app",
    "-e",
    "HOME=/tmp",
    "-e",
    "NODE_ENV=production",
  ];
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(SANDBOX_IMAGE);
  return args;
}

async function execContainer(
  command: string,
  args: string[],
  opts: ExecOpts
): Promise<ExecResult> {
  const status = await dockerStatus();
  if (!status.ok) {
    return {
      code: -1,
      timedOut: false,
      error: `Docker 不可用：${status.error ?? "unknown"}`,
    };
  }
  try {
    await ensureSandboxImage();
    const network = opts.network ?? BUILD_NETWORK;
    if (network === BUILD_NETWORK) await ensureBuildNetwork();
    else if (network === RUNTIME_NETWORK) await ensureRuntimeNetwork();
  } catch (err) {
    return {
      code: -1,
      timedOut: false,
      error: err instanceof Error ? err.message : "sandbox unavailable",
    };
  }

  const name = containerName("atoms-exec", opts.containerName);
  const network = opts.network ?? BUILD_NETWORK;
  const dockerArgs = [
    ...containerArgs({
      name,
      network,
      cwd: opts.cwd,
      memoryMB: opts.memoryMB,
      env: opts.env,
      remove: true,
    }),
    command,
    ...args,
  ];

  return new Promise((resolve) => {
    const child = spawn(DOCKER_BIN, dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: dockerEnv(),
    });
    if (child.stdout) pump(child.stdout, (l) => opts.onLog?.(l));
    if (child.stderr) pump(child.stderr, (l) => opts.onLog?.(l));

    let timedOut = false;
    let settled = false;
    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void runDocker(["rm", "-f", name], 15_000).finally(() => child.kill("SIGKILL"));
    }, opts.timeoutMs);

    child.on("close", (code) => finish({ code: code ?? -1, timedOut }));
    child.on("error", (err) =>
      finish({ code: -1, timedOut, error: err.message })
    );
  });
}

/**
 * 受限执行：container 模式在 Docker 内运行（非 root、只读 rootfs、cgroup 限额、无宿主挂载）；
 * process 模式仅在本地开发显式使用。参数始终以 argv 传递，不拼接 shell。
 */
export function execSandboxed(
  command: string,
  args: string[],
  opts: ExecOpts
): Promise<ExecResult> {
  if (opts.isolation === "container") return execContainer(command, args, opts);
  return execProcess(command, args, opts);
}

export type RuntimeHandle =
  | {
      kind: "process";
      child: ChildProcess;
      host: string;
      port: number;
    }
  | {
      kind: "container";
      containerId: string;
      name: string;
      host: string;
      port: number;
      logs: ChildProcess;
    };

async function containerIp(containerId: string): Promise<string> {
  const res = await runDocker(
    [
      "inspect",
      "-f",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      containerId,
    ],
    10_000
  );
  const ip = res.stdout.trim();
  if (res.code !== 0 || !ip) {
    throw new Error(
      `无法获取容器 IP：${(res.stderr || res.stdout || "empty").slice(-500)}`
    );
  }
  return ip;
}

export type RuntimeOpts = {
  cwd: string;
  port: number;
  env?: Record<string, string>;
  onLog?: (line: string) => void;
  isolation?: IsolationLevel;
  name?: string;
  onExit?: () => void;
};

/** 启动长驻运行时：container 模式每项目一个容器，返回容器 IP；process 模式返回子进程 */
export async function startRuntime(
  command: string,
  args: string[],
  opts: RuntimeOpts
): Promise<RuntimeHandle> {
  if (opts.isolation === "container") {
    const status = await dockerStatus();
    if (!status.ok) throw new Error(`Docker 不可用：${status.error ?? "unknown"}`);
    await ensureSandboxImage();
    await ensureRuntimeNetwork();

    const name = containerName("atoms-runtime", opts.name);
    // 崩溃恢复时可能残留同名容器，先清理再启动
    await runDocker(["rm", "-f", name], 15_000);
    const dockerArgs = [
      ...containerArgs({
        name,
        network: RUNTIME_NETWORK,
        cwd: opts.cwd,
        env: { PORT: String(opts.port), ...opts.env },
        init: true,
        remove: false,
        detach: true,
      }),
      command,
      ...args,
    ];
    const created = await runDocker(dockerArgs, 60_000);
    if (created.code !== 0) {
      throw new Error(
        `容器启动失败：${(created.stderr || created.stdout).slice(-800)}`
      );
    }
    const containerId = created.stdout.trim().split("\n").pop() ?? "";
    if (!containerId) throw new Error("容器启动失败：未返回容器 ID");
    let host: string;
    try {
      host = await containerIp(containerId);
    } catch (err) {
      await runDocker(["rm", "-f", containerId], 15_000);
      throw err;
    }

    const logs = spawn(DOCKER_BIN, ["logs", "-f", "--tail", "200", containerId], {
      stdio: ["ignore", "pipe", "pipe"],
      env: dockerEnv(),
    });
    if (logs.stdout) pump(logs.stdout, (l) => opts.onLog?.(l));
    if (logs.stderr) pump(logs.stderr, (l) => opts.onLog?.(l));
    logs.on("exit", () => opts.onExit?.());
    return { kind: "container", containerId, name, host, port: opts.port, logs };
  }

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: execEnv({
      cwd: opts.cwd,
      timeoutMs: 0,
      env: { PORT: String(opts.port), ...opts.env },
    }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  if (child.stdout) pump(child.stdout, (l) => opts.onLog?.(l));
  if (child.stderr) pump(child.stderr, (l) => opts.onLog?.(l));
  child.on("exit", () => opts.onExit?.());
  child.unref();
  return { kind: "process", child, host: "127.0.0.1", port: opts.port };
}

export async function stopRuntime(handle: RuntimeHandle): Promise<void> {
  if (handle.kind === "container") {
    try {
      handle.logs.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    await runDocker(["rm", "-f", handle.containerId], 20_000);
    return;
  }
  killProcessGroup(handle.child);
}

/** 读取 Docker 网络的宿主侧网关（用于运维/契约测试） */
export async function dockerNetworkGateway(
  name: string
): Promise<string | null> {
  const res = await runDocker(
    [
      "network",
      "inspect",
      "-f",
      "{{(index .IPAM.Config 0).Gateway}}",
      name,
    ],
    10_000
  );
  return res.code === 0 ? res.stdout.trim() || null : null;
}

/** 清理本实例遗留的孤儿容器（宿主重启/进程崩溃后） */
export async function cleanupOrphanContainers(
  activeIds: Set<string>
): Promise<number> {
  const status = await dockerStatus();
  if (!status.ok) return 0;
  const listed = await runDocker(
    [
      "ps",
      "-aq",
      "--filter",
      "label=atoms.managed=1",
      "--filter",
      `label=${INSTANCE_LABEL}`,
    ],
    15_000
  );
  if (listed.code !== 0) return 0;
  const ids = listed.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  let killed = 0;
  for (const id of ids) {
    if (activeIds.has(id)) continue;
    const res = await runDocker(["rm", "-f", id], 15_000);
    if (res.code === 0) killed += 1;
  }
  return killed;
}