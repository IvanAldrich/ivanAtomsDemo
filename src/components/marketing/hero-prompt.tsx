"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export function HeroPrompt({ isLoggedIn }: { isLoggedIn: boolean }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [hint, setHint] = useState(false);
  const [pending, setPending] = useState(false);

  async function start() {
    const prompt = value.trim();
    if (!prompt) {
      setHint(true);
      return;
    }
    setHint(false);
    if (!isLoggedIn) {
      router.push(`/${locale}/login?redirect=${encodeURIComponent(`/${locale}`)}`);
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { project: { id: string } };
      router.push(`/${locale}/chat/${data.project.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <textarea
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("promptPlaceholder")}
          className="flex-1 resize-none rounded-xl px-3 py-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
        />
        <button
          onClick={start}
          disabled={pending}
          className="shrink-0 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "…" : t("start")}
        </button>
      </div>
      {hint && (
        <p className="mt-2 text-center text-sm text-amber-600">
          {t("emptyInputHint")}
        </p>
      )}
    </div>
  );
}
