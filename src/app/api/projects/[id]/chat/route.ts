import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { buildQueue } from "@/lib/queue";
import { roundSseResponse } from "@/lib/sse";

/**
 * 发送消息并流式返回本轮构建事件（SSE）。
 * 事件格式：`data: {json}\n\n`，见 lib/build/orchestrator.ts 的 BuildEvent。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== auth.session.uid) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    content?: string;
  } | null;
  const content = body?.content?.trim();
  if (!content) {
    return Response.json({ error: "empty_content" }, { status: 400 });
  }

  const lastRound = await prisma.message.findFirst({
    where: { projectId: project.id, role: "user" },
    orderBy: { buildRound: "desc" },
    select: { buildRound: true },
  });
  const round = (lastRound?.buildRound ?? 0) + 1;

  const message = await prisma.message.create({
    data: {
      projectId: project.id,
      role: "user",
      content,
      buildRound: round,
      buildStatus: "queued",
    },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { status: "queued", updatedAt: new Date() },
  });

  return roundSseResponse(project.id, message.id, () =>
    buildQueue.enqueue({ projectId: project.id, messageId: message.id })
  );
}
