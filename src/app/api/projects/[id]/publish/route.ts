import { NextRequest, NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { runtimeManager } from "@/lib/runtime/manager";

const newSlug = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

/** 发布：分配 slug + 启动当前版本运行时；已发布时做原子上切换（失败回滚保旧版在线） */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== auth.session.uid) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!project.currentVersionId) {
    return NextResponse.json(
      { error: "no_buildable_version" },
      { status: 400 }
    );
  }

  // 运行当前版本；已发布且版本变化 → swap（失败保持旧版在线）
  let port: number | null = null;
  if (project.publishedSlug && project.publishedAt) {
    port = (await runtimeManager.swap(id, project.currentVersionId))?.port ?? null;
  } else {
    port = (await runtimeManager.start(id, project.currentVersionId))?.port ?? null;
  }
  if (!port) {
    return NextResponse.json(
      { error: "runtime_start_failed" },
      { status: 503 }
    );
  }

  const slug = project.publishedSlug ?? newSlug();
  await prisma.project.update({
    where: { id },
    data: { publishedSlug: slug, publishedAt: new Date(), updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, url: `/p/${slug}` });
}

/** 取消发布：停止运行时并移除公开路由（工作区仍可用） */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== auth.session.uid) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!project.publishedSlug) {
    return NextResponse.json({ error: "not_published" }, { status: 400 });
  }

  await runtimeManager.stop(id);
  await prisma.project.update({
    where: { id },
    data: { publishedSlug: null, publishedAt: null, updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
