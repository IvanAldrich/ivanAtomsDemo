import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/layout/logo";
import { Link } from "@/i18n/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { getTranslations } from "next-intl/server";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // 中间件守卫的兜底：布局层再验一次会话
  const session = await getSession();
  if (!session) {
    redirect(`/${locale}/login?redirect=${encodeURIComponent(`/${locale}/dashboard`)}`);
  }
  const t = await getTranslations({ locale });

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Logo />
              <span className="text-base font-semibold text-neutral-900">
                {t("brand")}
              </span>
            </Link>
            <span className="text-sm text-neutral-400">{t("workspace.title")}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-neutral-500 md:inline">
              {session.email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
