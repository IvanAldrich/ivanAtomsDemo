import { prisma } from "@/lib/prisma";

/**
 * 启动对账：服务重启会清空内存中的构建队列，
 * 把上次进程遗留的「进行中」状态统一标记为失败（用户可重试），避免永久卡住。
 */
export async function reconcileOrphanedRounds(): Promise<number> {
  const IN_FLIGHT = ["queued", "generating", "building", "repairing"];

  const orphanedMessages = await prisma.message.findMany({
    where: { role: "user", buildStatus: { in: IN_FLIGHT } },
    select: { id: true, projectId: true, buildRound: true },
  });
  if (orphanedMessages.length === 0) return 0;

  await prisma.message.updateMany({
    where: { id: { in: orphanedMessages.map((m) => m.id) } },
    data: { buildStatus: "failed" },
  });

  // 给每个受影响项目补一条说明，用户能在对话里看到并一键重试
  for (const m of orphanedMessages) {
    await prisma.message.create({
      data: {
        projectId: m.projectId,
        role: "assistant",
        content:
          "构建被中断（服务重启）。请点击「重试此轮」重新执行本次需求。",
        buildRound: m.buildRound,
        buildStatus: "failed",
      },
    });
  }

  const affectedProjects = [...new Set(orphanedMessages.map((m) => m.projectId))];
  await prisma.project.updateMany({
    where: { id: { in: affectedProjects } },
    data: { status: "failed" },
  });

  return orphanedMessages.length;
}