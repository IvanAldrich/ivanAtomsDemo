import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { ContentList } from "@/components/marketing/content-catalog";
import { publishedByCategory, uniqueProviders } from "@/content/entries";

export default async function ModelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ provider?: string }>;
}) {
  const { locale } = await params;
  const { provider } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("pages.models");
  void t;

  const entries = publishedByCategory("models").filter(
    (e) => !provider || e.provider === provider
  );

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 pt-12">
        <h1 className="text-3xl font-bold text-neutral-900">
          {t("title")}
        </h1>
        <p className="mt-2 text-neutral-600">{t("desc")}</p>
      </div>
      <ContentList
        entries={entries}
        locale={locale}
        basePath="/models"
        filters={uniqueProviders("models")}
        activeFilter={provider}
        filterParam="provider"
      />
    </>
  );
}
