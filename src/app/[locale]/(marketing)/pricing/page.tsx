import { setRequestLocale } from "next-intl/server";
import { PricingTable } from "@/components/marketing/pricing-table";
import { getSession } from "@/lib/session";

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  return <PricingTable isLoggedIn={session !== null} />;
}
