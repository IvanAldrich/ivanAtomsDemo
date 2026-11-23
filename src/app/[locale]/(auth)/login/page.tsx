import { setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import { sanitizeRedirect } from "@/lib/redirect";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { locale } = await params;
  const { redirect: redirectParam } = await searchParams;
  setRequestLocale(locale);

  const fallback = `/${locale}/dashboard`;
  const redirectTo = sanitizeRedirect(redirectParam, fallback);

  return <LoginForm locale={locale} redirectTo={redirectTo} />;
}
