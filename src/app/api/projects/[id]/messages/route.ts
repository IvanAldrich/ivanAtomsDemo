import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

export async function GET(
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

  const messages = await prisma.message.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      buildRound: true,
      buildStatus: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ messages });
}
