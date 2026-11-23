import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { ContentDetail } from "@/components/marketing/content-catalog";
import { bySlug, pickText, publishedByCategory } from "@/content/entries";

export function generateStaticParams() {
  return publishedByCategory("models").map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const entry = bySlug("models", slug);
  if (!entry) return {};
  return {
    title: pickText(entry.title, locale),
    description: pickText(entry.subtitle, locale),
    openGraph: {
      title: pickText(entry.title, locale),
      description: pickText(entry.subtitle, locale),
    },
  };
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const entry = bySlug("models", slug);
  if (!entry) notFound();
  void getTranslations;
  return <ContentDetail entry={entry} locale={locale} />;
}
