import { PlaceholderPage } from "@/components/marketing/placeholder";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <PlaceholderPage locale={locale} ns="discover" />;
}
