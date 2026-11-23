import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { BuildWhatSection, HeroPrompt } from "@/components/marketing/build-what";
import { getSession } from "@/lib/session";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const session = await getSession();

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-gradient-to-b from-brand-50 to-transparent" />
      <section className="mx-auto max-w-4xl px-4 pb-8 pt-24 text-center">
        <span className="inline-block rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          {t("heroBadge")}
        </span>
        <h1 className="mt-6 whitespace-pre-line text-4xl font-bold leading-tight text-neutral-900 md:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-neutral-600">
          {t("heroSubtitle")}
        </p>
        <HeroPrompt isLoggedIn={session !== null} />
      </section>

      <BuildWhatSection isLoggedIn={session !== null} />

      <section className="border-t border-neutral-100 bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold text-neutral-900">
            {t("trustTitle")}
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-6 text-center sm:grid-cols-3">
            {["sandbox", "stack", "ship"].map((k) => (
              <div key={k} className="rounded-xl bg-white p-6 shadow-sm">
                <h3 className="text-base font-semibold text-neutral-900">
                  {t(`trust.${k}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                  {t(`trust.${k}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
