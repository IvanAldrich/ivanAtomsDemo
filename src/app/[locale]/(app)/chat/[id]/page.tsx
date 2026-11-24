import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { ChatView } from "@/components/chat/chat-view";
import { previewToken } from "@/lib/preview-token";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  const project = await prisma.project.findUnique({ where: { id } });
  // 访问隔离：不存在或他人项目一律 404
  if (!project || !session || project.ownerId !== session.uid) {
    notFound();
  }

  const messages = await prisma.message.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ChatView
      projectId={project.id}
      projectTitle={project.title}
      previewToken={previewToken(project.id)}
      initialStatus={project.status}
      hasVersion={project.currentVersionId !== null}
      initialPublishedSlug={project.publishedSlug}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        buildRound: m.buildRound,
        buildStatus: m.buildStatus,
      }))}
    />
  );
}
