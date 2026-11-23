import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { buildQueue } from "@/lib/queue";
import { ensureProjectDirs } from "@/lib/storage";

const createSchema = z.object({
  title: z.string().max(120).optional(),
  prompt: z.string().max(20000).optional(),
});

export async function GET() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  const projects = await prisma.project.findMany({
    where: { ownerId: auth.session.uid },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      publishedSlug: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const prompt = parsed.data.prompt?.trim();
  const project = await prisma.project.create({
    data: {
      ownerId: auth.session.uid,
      title: parsed.data.title?.trim() || prompt?.slice(0, 40) || "未命名项目",
    },
  });
  await ensureProjectDirs(project.id);

  // 首条需求消息：立即入队构建
  if (prompt) {
    const round = 1;
    const message = await prisma.message.create({
      data: {
        projectId: project.id,
        role: "user",
        content: prompt,
        buildRound: round,
        buildStatus: "queued",
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "queued" },
    });
    buildQueue.enqueue({ projectId: project.id, messageId: message.id });
  }

  return NextResponse.json({ project: { id: project.id } }, { status: 201 });
}
