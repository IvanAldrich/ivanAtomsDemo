import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  const t = await getTranslations("workspace");

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
      <p className="mt-2 text-sm text-neutral-500">{session?.email}</p>
      <div className="mt-8 rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-neutral-500">
        {t("projectsComing")}
      </div>
    </div>
  );
}
