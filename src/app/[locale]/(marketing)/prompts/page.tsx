import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { ContentList } from "@/components/marketing/content-catalog";
import { publishedByCategory, uniqueTopics } from "@/content/entries";

export default async function PromptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ topic?: string }>;
}) {
  const { locale } = await params;
  const { topic } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("pages.prompts");

  const entries = publishedByCategory("prompts").filter(
    (e) => !topic || e.topic === topic
  );

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 pt-12">
        <h1 className="text-3xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="mt-2 text-neutral-600">{t("desc")}</p>
      </div>
      <ContentList
        entries={entries}
        locale={locale}
        basePath="/prompts"
        filters={uniqueTopics("prompts")}
        activeFilter={topic}
        filterParam="topic"
      />
    </>
  );
}
