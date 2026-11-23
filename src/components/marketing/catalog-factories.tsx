import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ContentDetail, ContentList } from "@/components/marketing/content-catalog";
import { bySlug, pickText, publishedByCategory } from "@/content/entries";
import { getTranslations } from "next-intl/server";

function makeList(category: "usecases" | "comparison" | "discover") {
  return async function ListPage({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }) {
    const { locale } = await params;
    setRequestLocale(locale);
    const t = await getTranslations(`pages.${category}`);
    return (
      <>
        <div className="mx-auto max-w-4xl px-4 pt-12">
          <h1 className="text-3xl font-bold text-neutral-900">{t("title")}</h1>
          <p className="mt-2 text-neutral-600">{t("desc")}</p>
        </div>
        <ContentList
          entries={publishedByCategory(category)}
          locale={locale}
          basePath={`/${category}`}
        />
      </>
    );
  };
}

function makeDetail(category: "usecases" | "comparison" | "discover") {
  return async function DetailPage({
    params,
  }: {
    params: Promise<{ locale: string; slug: string }>;
  }) {
    const { locale, slug } = await params;
    setRequestLocale(locale);
    const entry = bySlug(category, slug);
    if (!entry) notFound();
    return <ContentDetail entry={entry} locale={locale} />;
  };
}

export function makeStaticParams(category: "usecases" | "comparison" | "discover") {
  return () => publishedByCategory(category).map((e) => ({ slug: e.slug }));
}

export function makeMetadata(category: "usecases" | "comparison" | "discover") {
  return async function Metadata({
    params,
  }: {
    params: Promise<{ locale: string; slug: string }>;
  }) {
    const { locale, slug } = await params;
    const entry = bySlug(category, slug);
    if (!entry) return {};
    return {
      title: pickText(entry.title, locale),
      description: pickText(entry.subtitle, locale),
      openGraph: {
        title: pickText(entry.title, locale),
        description: pickText(entry.subtitle, locale),
      },
    };
  };
}

export const UsecasesList = makeList("usecases");
export const UsecasesDetail = makeDetail("usecases");
export const ComparisonList = makeList("comparison");
export const ComparisonDetail = makeDetail("comparison");
export const DiscoverList = makeList("discover");
export const DiscoverDetail = makeDetail("discover");
