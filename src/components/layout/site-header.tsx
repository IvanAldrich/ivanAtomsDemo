import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "./locale-switcher";
import { Logo } from "./logo";

export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-base font-semibold text-neutral-900">
              {t("brand")}
            </span>
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-neutral-600 md:flex">
            <Link className="hover:text-neutral-900" href="/pricing">
              {t("nav.pricing")}
            </Link>
            <Link className="hover:text-neutral-900" href="/models">
              {t("nav.models")}
            </Link>
            <Link className="hover:text-neutral-900" href="/discover">
              {t("nav.discover")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Link
            href="/login"
            className="rounded-md bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            {t("nav.login")}
          </Link>
        </div>
      </div>
    </header>
  );
}
