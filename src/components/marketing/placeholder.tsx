import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";

export async function PlaceholderPage({
  locale,
  ns,
}: {
  locale: string;
  ns: string;
}) {
  setRequestLocale(locale);
  const t = await getTranslations(`pages.${ns}`);
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold text-neutral-900">{t("title")}</h1>
      <p className="mt-4 text-neutral-600">{t("desc")}</p>
    </div>
  );
}
