import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-gradient-to-b from-brand-50 to-transparent" />
      <section className="mx-auto max-w-4xl px-4 pb-20 pt-24 text-center">
        <span className="inline-block rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          {t("heroBadge")}
        </span>
        <h1 className="mt-6 whitespace-pre-line text-4xl font-bold leading-tight text-neutral-900 md:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-neutral-600">
          {t("heroSubtitle")}
        </p>
        <div className="mx-auto mt-8 flex max-w-2xl items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
          <textarea
            rows={2}
            placeholder={t("promptPlaceholder")}
            className="flex-1 resize-none rounded-xl px-3 py-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
          />
          <Link
            href="/login"
            className="shrink-0 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            {t("start")}
          </Link>
        </div>
      </section>
    </div>
  );
}
