"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

export function LogoutButton() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = `/${locale}`;
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={logout}
      disabled={pending}
      className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 disabled:opacity-60"
    >
      {t("logout")}
    </button>
  );
}
