import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  cleanupOrphanContainers,
  isolationLevel,
  startRuntime,
  stopRuntime,
  type RuntimeHandle,
} from "@/lib/build/executor";
import { waitForPort, pickFreePort } from "@/lib/ports";
import { projectRoot } from "@/lib/storage";

type RuntimeEntry = {
  projectId: string;
  versionId: string;
  handle: RuntimeHandle;
};

const globalForRuntime = globalThis as unknown as {
  __runtimeManager?: RuntimeManager;
};

const START_TIMEOUT = 45 * 1000;

class RuntimeManager {
  private entries = new Map<string, RuntimeEntry>();
  private busy = new Map<string, Promise<unknown>>();

  /** 同一项目的 start/stop/swap 串行化，避免并发请求产生双容器 */
  private serialize<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.busy.get(projectId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.busy.set(projectId, next);
    void next.finally(() => {
      if (this.busy.get(projectId) === next) this.busy.delete(projectId);
    });
    return next;
  }

  hostFor(projectId: string): string | null {
    return this.entries.get(projectId)?.handle.host ?? null;
  }

  portFor(projectId: string): number | null {
    return this.entries.get(projectId)?.handle.port ?? null;
  }

  versionFor(projectId: string): string | null {
    return this.entries.get(projectId)?.versionId ?? null;
  }

  isRunning(projectId: string): boolean {
    return this.entries.has(projectId);
  }

  isolation(): Promise<{ level: "process" | "container"; degraded: boolean }> {
    return isolationLevel();
  }

  /** 启动运行时（不注册路由）：暂存用 */
  private async startHandle(
    projectId: string,
    versionId: string
  ): Promise<RuntimeEntry | null> {
    const version = await prisma.appVersion.findUnique({
      where: { id: versionId },
    });
    if (!version || version.projectId !== projectId) return null;

    const iso = await isolationLevel();
    const port = iso.level === "container" ? 3000 : await pickFreePort();
    const logFile = path.join(projectRoot(projectId), "runtime.log");
    const appendLog = (line: string) => {
      void (async () => {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(logFile, line + "\n").catch(() => {});
      })();
    };

    let handle: RuntimeHandle | null = null;
    const entryProbe = () => {
      const current = this.entries.get(projectId);
      if (handle && current?.handle === handle) {
        this.entries.delete(projectId);
        void stopRuntime(handle).catch(() => undefined);
        void prisma.project
          .update({
            where: { id: projectId },
            data: { runtimeStatus: "crashed", port: null },
          })
          .catch(() => {});
      }
    };

    let started: RuntimeHandle;
    try {
      started = await startRuntime("npm", ["start"], {
        cwd: version.snapshotDir,
        port,
        env: { PORT: String(port) },
        isolation: iso.level,
        onLog: appendLog,
        name: `atoms-runtime-${projectId}-${versionId}`,
        onExit: entryProbe,
      });
      handle = started;
    } catch (err) {
      appendLog(`[runtime] start failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }

    const ready = await waitForPort(started.host, started.port, START_TIMEOUT);
    if (!ready) {
      appendLog(`[runtime] port ${started.host}:${started.port} not ready`);
      await stopRuntime(started).catch(() => undefined);
      return null;
    }
    return { projectId, versionId, handle: started };
  }

  private async register(entry: RuntimeEntry) {
    this.entries.set(entry.projectId, entry);
    await prisma.project
      .update({
        where: { id: entry.projectId },
        data: { runtimeStatus: "running", port: entry.handle.port },
      })
      .catch(() => {});
    await writeRunFile(entry.projectId, {
      kind: entry.handle.kind,
      port: entry.handle.port,
      host: entry.handle.host,
      versionId: entry.versionId,
      containerId:
        entry.handle.kind === "container" ? entry.handle.containerId : undefined,
      name: entry.handle.kind === "container" ? entry.handle.name : undefined,
      pid: entry.handle.kind === "process" ? entry.handle.child.pid : undefined,
      startedAt: new Date().toISOString(),
    });
  }

  /** 启动指定版本运行时（同版本幂等；不同版本直接替换） */
  async start(projectId: string, versionId: string): Promise<{ port: number } | null> {
    return this.serialize(projectId, async () => {
      const cur = this.entries.get(projectId);
      if (cur?.versionId === versionId) return { port: cur.handle.port };
      const entry = await this.startHandle(projectId, versionId);
      if (!entry) return null;
      if (cur) await stopRuntime(cur.handle).catch(() => undefined);
      await this.register(entry);
      return { port: entry.handle.port };
    });
  }

  async stop(projectId: string) {
    return this.serialize(projectId, async () => {
      const entry = this.entries.get(projectId);
      this.entries.delete(projectId);
      if (entry) await stopRuntime(entry.handle).catch(() => undefined);
      await prisma.project
        .update({
          where: { id: projectId },
          data: { runtimeStatus: "stopped", port: null },
        })
        .catch(() => {});
      await rm(runFile(projectId), { force: true }).catch(() => {});
    });
  }

  /**
   * 原子替换：新版本先在暂存端口完成启动验证，成功才切换注册并停旧运行时；
   * 失败则停掉暂存运行时，旧版本保持在线。
   */
  async swap(
    projectId: string,
    newVersionId: string
  ): Promise<{ port: number } | null> {
    return this.serialize(projectId, async () => {
      const old = this.entries.get(projectId);
      if (old?.versionId === newVersionId) return { port: old.handle.port };

      const staged = await this.startHandle(projectId, newVersionId);
      if (!staged) return null; // 旧版本不受影响

      if (old) await stopRuntime(old.handle).catch(() => undefined);
      await this.register(staged);
      return { port: staged.handle.port };
    });
  }

  /** 清理上次进程/容器遗留的孤儿运行时 */
  async cleanupOrphanedProcesses(): Promise<number> {
    const { readdir } = await import("node:fs/promises");
    const projectsRoot = path.join(process.cwd(), "storage", "projects");
    let dirs: string[] = [];
    try {
      dirs = await readdir(projectsRoot);
    } catch {
      return 0;
    }
    let killed = 0;
    for (const id of dirs) {
      if (this.entries.has(id)) continue;
      const run = await readRunFile(id);
      const pid = Number(run?.pid);
      if (!Number.isInteger(pid) || pid <= 1) continue;
      try {
        process.kill(-pid, "SIGKILL"); // 进程组（spawnRuntime 以 detached 创建）
        killed += 1;
      } catch {
        /* 已不存在 */
      }
      // 保留 run.json：recover() 依赖它判断该项目曾处于发布运行状态
    }
    const activeContainers = new Set(
      [...this.entries.values()]
        .filter((e) => e.handle.kind === "container")
        .map((e) => (e.handle.kind === "container" ? e.handle.containerId : ""))
        .filter(Boolean)
    );
    killed += await cleanupOrphanContainers(activeContainers).catch(() => 0);
    return killed;
  }

  /** 宿主重启后的 best-effort 恢复：按 run.json 重启已发布项目 */
  async recover(): Promise<string[]> {
    const recovered: string[] = [];
    const published = await prisma.project.findMany({
      where: { publishedSlug: { not: null }, currentVersionId: { not: null } },
      select: { id: true, currentVersionId: true },
    });
    for (const p of published) {
      if (!p.currentVersionId || this.entries.has(p.id)) continue;
      const run = await readRunFile(p.id);
      if (!run) continue;
      const ok = await this.start(p.id, p.currentVersionId).catch(() => null);
      if (ok) recovered.push(p.id);
    }
    return recovered;
  }
}

function runFile(projectId: string) {
  return path.join(projectRoot(projectId), "run.json");
}

async function writeRunFile(projectId: string, data: object) {
  const file = runFile(projectId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}

async function readRunFile(projectId: string) {
  try {
    return JSON.parse(await readFile(runFile(projectId), "utf8"));
  } catch {
    return null;
  }
}

export const runtimeManager =
  globalForRuntime.__runtimeManager ?? new RuntimeManager();
globalForRuntime.__runtimeManager = runtimeManager;