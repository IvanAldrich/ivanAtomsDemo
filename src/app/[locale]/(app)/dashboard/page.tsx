import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { NewProjectDialog } from "@/components/workspace/new-project-dialog";
import { ProjectList } from "@/components/workspace/project-list";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  const t = await getTranslations("workspace");

  const projects = await prisma.project.findMany({
    where: { ownerId: session?.uid ?? "" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      publishedSlug: true,
      updatedAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-neutral-500">{session?.email}</p>
        </div>
        <NewProjectDialog />
      </div>
      <ProjectList
        initialProjects={projects.map((p) => ({
          ...p,
          updatedAt: p.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
