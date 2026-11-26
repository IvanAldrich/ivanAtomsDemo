import { prisma } from "@/lib/prisma";
import { readWorkerHeartbeat, workerAlive } from "@/lib/worker-heartbeat";

const IN_FLIGHT = ["queued", "generating", "building", "repairing"];

/**
 * 启动对账：只清理真正没有执行者的轮次。
 * 独立 worker 的队列是持久化的，Web 重启不应误杀正在运行/排队中的任务。
 */
export async function reconcileOrphanedRounds(): Promise<number> {
  const messages = await prisma.message.findMany({
    where: { role: "user", buildStatus: { in: IN_FLIGHT } },
    select: { id: true, projectId: true, buildRound: true },
  });
  if (messages.length === 0) return 0;

  const jobs = await prisma.buildJob.findMany({
    where: { messageId: { in: messages.map((m) => m.id) } },
    select: {
      id: true,
      messageId: true,
      status: true,
      leaseUntil: true,
    },
  });
  const byMessage = new Map(jobs.map((j) => [j.messageId, j]));

  const heartbeat = await readWorkerHeartbeat();
  const worker = workerAlive(heartbeat);
  const now = Date.now();

  const orphaned = messages.filter((m) => {
    const job = byMessage.get(m.id);
    if (!job) return true; // 没有持久化任务，无法再被执行
    if (job.status === "queued") return false; // 等 worker 领取即可
    if (job.status === "leased" || job.status === "running") {
      const lease = job.leaseUntil?.getTime() ?? 0;
      if (lease > now) return false; // 仍有有效租约
      return !worker; // 租约过期且 worker 不在线，才判定中断
    }
    return job.status === "done" || job.status === "failed";
  });
  if (orphaned.length === 0) return 0;

  for (const m of orphaned) {
    const job = byMessage.get(m.id);
    await prisma.message.update({
      where: { id: m.id },
      data: { buildStatus: "failed" },
    });
    const existing = await prisma.message.findFirst({
      where: {
        projectId: m.projectId,
        role: "assistant",
        buildRound: m.buildRound,
        buildStatus: "failed",
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.message.create({
        data: {
          projectId: m.projectId,
          role: "assistant",
          content:
            "构建被中断（执行器中断或服务重启）。请点击「重试此轮」重新执行本次需求。",
          buildRound: m.buildRound,
          buildStatus: "failed",
        },
      });
    }
    if (job && job.status !== "queued") {
      await prisma.buildJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          leaseOwner: null,
          leaseUntil: null,
          lastError: "orphaned round reconciled",
        },
      });
    }
  }

  const affectedProjects = [...new Set(orphaned.map((m) => m.projectId))];
  await prisma.project.updateMany({
    where: { id: { in: affectedProjects } },
    data: { status: "failed" },
  });

  return orphaned.length;
}