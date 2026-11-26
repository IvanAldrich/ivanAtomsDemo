import os from "node:os";
import { prisma } from "./prisma";
import type { BuildEvent } from "./build/orchestrator";

export type Job = { projectId: string; messageId: string };

const LEASE_MS = 90_000;
const WORKER_ID = `${os.hostname()}:${process.pid}:${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const appendChains = new Map<string, Promise<void>>();

/**
 * 持久化构建队列（SQLite/Prisma）。
 * Web 进程只入队；独立 worker 进程 claim/lease/heartbeat；事件落库供 SSE 回放。
 */
class BuildQueue {
  /** 入队（幂等）。失败/完成的任务被重试时清空旧事件并重置。 */
  async enqueue(job: Job): Promise<void> {
    const existing = await prisma.buildJob.findUnique({
      where: { messageId: job.messageId },
    });
    if (!existing) {
      await prisma.buildJob.create({
        data: { projectId: job.projectId, messageId: job.messageId },
      });
      return;
    }
    if (existing.status === "failed" || existing.status === "done") {
      await prisma.$transaction([
        prisma.buildEvent.deleteMany({ where: { messageId: job.messageId } }),
        prisma.buildJob.update({
          where: { id: existing.id },
          data: {
            status: "queued",
            attempts: 0,
            leaseOwner: null,
            leaseUntil: null,
            lastError: null,
          },
        }),
      ]);
    }
  }

  /** 领取一个任务；过期租约可被重新领取，超过重试上限则标记失败 */
  async claim(): Promise<
    (Job & { id: string; attempts: number; maxAttempts: number }) | null
  > {
    const now = new Date();
    const candidates = await prisma.buildJob.findMany({
      where: {
        OR: [
          { status: "queued" },
          {
            status: { in: ["leased", "running"] },
            leaseUntil: { lt: now },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    for (const c of candidates) {
      if (c.attempts >= c.maxAttempts) {
        await prisma.buildJob
          .updateMany({
            where: { id: c.id, status: c.status },
            data: {
              status: "failed",
              leaseOwner: null,
              leaseUntil: null,
              lastError: "lease expired after max attempts",
            },
          })
          .catch(() => undefined);
        continue;
      }
      const updated = await prisma.buildJob.updateMany({
        where: {
          id: c.id,
          status: c.status,
          ...(c.status === "queued" ? {} : { leaseUntil: { lt: now } }),
        },
        data: {
          status: "leased",
          leaseOwner: WORKER_ID,
          leaseUntil: new Date(Date.now() + LEASE_MS),
          attempts: { increment: 1 },
        },
      });
      if (updated.count === 1) {
        return {
          id: c.id,
          projectId: c.projectId,
          messageId: c.messageId,
          attempts: c.attempts + 1,
          maxAttempts: c.maxAttempts,
        };
      }
    }
    return null;
  }

  async markRunning(id: string): Promise<void> {
    await prisma.buildJob.updateMany({
      where: { id, leaseOwner: WORKER_ID },
      data: {
        status: "running",
        leaseUntil: new Date(Date.now() + LEASE_MS),
      },
    });
  }

  async heartbeat(id: string): Promise<void> {
    await prisma.buildJob.updateMany({
      where: { id, leaseOwner: WORKER_ID },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
  }

  async complete(id: string): Promise<void> {
    await prisma.buildJob.updateMany({
      where: { id },
      data: { status: "done", leaseOwner: null, leaseUntil: null },
    });
  }

  async fail(id: string, error: string, retryable = false): Promise<void> {
    const job = await prisma.buildJob.findUnique({ where: { id } });
    if (!job) return;
    const exhausted = job.attempts >= job.maxAttempts;
    await prisma.buildJob.update({
      where: { id },
      data: {
        status: retryable && !exhausted ? "queued" : "failed",
        leaseOwner: null,
        leaseUntil: null,
        lastError: error.slice(0, 4000),
      },
    });
  }

  /** 事件按 messageId 串行追加，保证 seq 单调，SSE 可断线回放 */
  appendEvent(messageId: string, event: BuildEvent): Promise<void> {
    const prev = appendChains.get(messageId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const last = await prisma.buildEvent.findFirst({
          where: { messageId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        await prisma.buildEvent.create({
          data: {
            messageId,
            seq: (last?.seq ?? 0) + 1,
            payload: JSON.stringify(event),
          },
        });
      })
      .catch(() => undefined);
    appendChains.set(messageId, next);
    void next.finally(() => {
      if (appendChains.get(messageId) === next) appendChains.delete(messageId);
    });
    return next;
  }

  async eventsSince(
    messageId: string,
    sinceSeq: number
  ): Promise<Array<{ seq: number; event: BuildEvent }>> {
    const rows = await prisma.buildEvent.findMany({
      where: { messageId, seq: { gt: sinceSeq } },
      orderBy: { seq: "asc" },
      take: 500,
    });
    return rows.map((r) => ({
      seq: r.seq,
      event: JSON.parse(r.payload) as BuildEvent,
    }));
  }

  async jobStatus(messageId: string): Promise<string | null> {
    const job = await prisma.buildJob.findUnique({
      where: { messageId },
      select: { status: true },
    });
    return job?.status ?? null;
  }

  /** 清理过期事件（worker 定期调用） */
  async pruneEvents(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const res = await prisma.buildEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return res.count;
  }
}

const globalForQueue = globalThis as unknown as { __buildQueue?: BuildQueue };

export const buildQueue = globalForQueue.__buildQueue ?? new BuildQueue();
globalForQueue.__buildQueue = buildQueue;