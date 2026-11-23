import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { buildQueue } from "@/lib/queue";
import { roundSseResponse } from "@/lib/sse";

/** 重试失败轮次：清理失败产物、重置状态并重新入队（SSE 流式回传本轮事件） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== auth.session.uid) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    messageId?: string;
  } | null;
  const messageId = body?.messageId;
  if (!messageId) {
    return NextResponse.json({ error: "message_id_required" }, { status: 400 });
  }

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (
    !message ||
    message.projectId !== project.id ||
    message.role !== "user" ||
    message.buildStatus !== "failed"
  ) {
    return NextResponse.json({ error: "not_retryable" }, { status: 400 });
  }

  // 清掉失败轮的 assistant 消息，重置状态
  if (message.buildRound != null) {
    await prisma.message.deleteMany({
      where: {
        projectId: project.id,
        role: "assistant",
        buildRound: message.buildRound,
        buildStatus: "failed",
      },
    });
  }
  await prisma.message.update({
    where: { id: message.id },
    data: { buildStatus: "queued" },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { status: "queued", updatedAt: new Date() },
  });

  return roundSseResponse(project.id, message.id, () =>
    buildQueue.enqueue({ projectId: project.id, messageId: message.id })
  );
}
