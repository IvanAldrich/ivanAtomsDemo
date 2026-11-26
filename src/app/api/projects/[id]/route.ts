import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { removeProjectStorage } from "@/lib/storage";
import { runtimeManager } from "@/lib/runtime/manager";

async function ownedProject(id: string, uid: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== uid) return null;
  return project;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const project = await ownedProject(id, auth.session.uid);
  if (!project) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const project = await ownedProject(id, auth.session.uid);
  if (!project) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 级联：终止运行时 → 清理磁盘 → DB（Project 级联删除消息、版本与任务）
  await runtimeManager.stop(project.id).catch(() => undefined);
  await removeProjectStorage(project.id);
  const messageIds = await prisma.message.findMany({
    where: { projectId: project.id },
    select: { id: true },
  });
  if (messageIds.length > 0) {
    await prisma.buildEvent.deleteMany({
      where: { messageId: { in: messageIds.map((m) => m.id) } },
    });
  }
  await prisma.project.delete({ where: { id: project.id } });

  return NextResponse.json({ ok: true });
}
