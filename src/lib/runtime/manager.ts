import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { spawnRuntime } from "@/lib/build/executor";
import { killTree } from "@/lib/build/builder";
import { waitForPort, pickFreePort } from "@/lib/ports";
import { projectRoot } from "@/lib/storage";

type RuntimeEntry = {
  projectId: string;
  child: ChildProcess;
  port: number;
  versionId: string;
};

const globalForRuntime = globalThis as unknown as {
  __runtimeManager?: RuntimeManager;
};

const START_TIMEOUT = 30 * 1000;

class RuntimeManager {
  private entries = new Map<string, RuntimeEntry>();

  portFor(projectId: string): number | null {
    return this.entries.get(projectId)?.port ?? null;
  }

  versionFor(projectId: string): string | null {
    return this.entries.get(projectId)?.versionId ?? null;
  }

  isRunning(projectId: string): boolean {
    return this.entries.has(projectId);
  }

  /** 启动进程（不注册路由）：暂存用 */
  private async startProcess(
    projectId: string,
    versionId: string
  ): Promise<RuntimeEntry | null> {
    const version = await prisma.appVersion.findUnique({
      where: { id: versionId },
    });
    if (!version || version.projectId !== projectId) return null;

    const port = await pickFreePort();
    const logFile = path.join(projectRoot(projectId), "runtime.log");
    const child = spawnRuntime("npm", ["start"], {
      cwd: version.snapshotDir,
      env: { PORT: String(port) },
      onLog: (line) => {
        void (async () => {
          const { appendFile } = await import("node:fs/promises");
          await appendFile(logFile, line + "\n").catch(() => {});
        })();
      },
    });

    const entry: RuntimeEntry = { projectId, child, port, versionId };
    const ready = await waitForPort("127.0.0.1", port, START_TIMEOUT);
    if (!ready) {
      killTree(child);
      return null;
    }
    return entry;
  }

  private async register(entry: RuntimeEntry) {
    this.entries.set(entry.projectId, entry);
    entry.child.on("exit", () => {
      if (this.entries.get(entry.projectId)?.child === entry.child) {
        this.entries.delete(entry.projectId);
        void prisma.project
          .update({
            where: { id: entry.projectId },
            data: { runtimeStatus: "crashed", port: null },
          })
          .catch(() => {});
      }
    });
    await prisma.project
      .update({
        where: { id: entry.projectId },
        data: { runtimeStatus: "running", port: entry.port },
      })
      .catch(() => {});
    await writeRunFile(entry.projectId, {
      port: entry.port,
      versionId: entry.versionId,
      pid: entry.child.pid,
      startedAt: new Date().toISOString(),
    });
  }

  /** 启动指定版本运行时（同版本幂等；不同版本直接替换） */
  async start(projectId: string, versionId: string): Promise<{ port: number } | null> {
    const cur = this.entries.get(projectId);
    if (cur?.versionId === versionId) return { port: cur.port };
    const entry = await this.startProcess(projectId, versionId);
    if (!entry) return null;
    if (cur) killTree(cur.child);
    await this.register(entry);
    return { port: entry.port };
  }

  async stop(projectId: string) {
    const entry = this.entries.get(projectId);
    this.entries.delete(projectId);
    if (entry) killTree(entry.child);
    await prisma.project
      .update({
        where: { id: projectId },
        data: { runtimeStatus: "stopped", port: null },
      })
      .catch(() => {});
    await rm(runFile(projectId), { force: true }).catch(() => {});
  }

  /**
   * 原子替换：新版本先在暂存端口完成启动验证，成功才切换注册并停旧进程；
   * 失败则杀掉暂存进程，旧版本保持在线。
   */
  async swap(
    projectId: string,
    newVersionId: string
  ): Promise<{ port: number } | null> {
    const old = this.entries.get(projectId);
    if (old?.versionId === newVersionId) return { port: old.port };

    const staged = await this.startProcess(projectId, newVersionId);
    if (!staged) return null; // 旧版本不受影响

    if (old) killTree(old.child);
    await this.register(staged);
    return { port: staged.port };
  }

  /** 清理上次进程遗留的孤儿运行时（run.json 记录 pid，进程组整体终止） */
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
  await writeFile(runFile(projectId), JSON.stringify(data, null, 2), "utf8");
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
