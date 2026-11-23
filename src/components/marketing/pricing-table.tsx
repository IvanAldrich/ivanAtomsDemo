"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const TIERS = ["free", "pro", "max"] as const;

export function PricingTable({ isLoggedIn }: { isLoggedIn: boolean }) {
  const t = useTranslations("pricing");
  const router = useRouter();
  const [annual, setAnnual] = useState(false);
  const [cloning, setCloning] = useState(false);

  async function start() {
    if (cloning) return;
    if (isLoggedIn) {
      setCloning(true);
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "一个待办事项应用" }),
        });
        if (res.ok) {
          const data = (await res.json()) as { project: { id: string } };
          router.push(`/chat/${data.project.id}`);
        }
      } finally {
        setCloning(false);
      }
    } else {
      router.push("/login");
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="mt-2 text-neutral-600">{t("subtitle")}</p>
        <div className="mt-6 inline-flex rounded-full border border-neutral-200 p-1 text-sm">
          <button
            onClick={() => setAnnual(false)}
            className={`rounded-full px-4 py-1.5 ${
              !annual ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
            }`}
          >
            {t("monthly")}
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`rounded-full px-4 py-1.5 ${
              annual ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
            }`}
          >
            {t("annual")} · {t("save")}
          </button>
        </div>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier}
            className={`rounded-2xl border bg-white p-6 shadow-sm ${
              tier === "pro" ? "border-brand-300 ring-2 ring-brand-100" : "border-neutral-200"
            }`}
          >
            <h2 className="text-lg font-semibold text-neutral-900">
              {t(`tiers.${tier}.name`)}
            </h2>
            <p className="mt-2">
              <span className="text-3xl font-bold text-neutral-900">
                {annual
                  ? t(`tiers.${tier}.annualPrice`)
                  : t(`tiers.${tier}.monthlyPrice`)}
              </span>
              <span className="text-sm text-neutral-500"> / {t("month")}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-neutral-700">
              {t.raw(`tiers.${tier}.features`).map((f: string) => (
                <li key={f} className="flex gap-2">
                  <span className="text-brand-600">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={start}
              disabled={cloning}
              className={`mt-6 w-full rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                tier === "pro"
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "border border-neutral-300 text-neutral-800 hover:border-neutral-400"
              }`}
            >
              {cloning ? "…" : t("cta")}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-14">
        <h2 className="text-xl font-bold text-neutral-900">{t("faqTitle")}</h2>
        <div className="mt-4 space-y-2">
          {t.raw("faqs").map((f: { q: string; a: string }) => (
            <details
              key={f.q}
              className="rounded-xl border border-neutral-200 bg-white px-5 py-4"
            >
              <summary className="cursor-pointer text-sm font-medium text-neutral-900">
                {f.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
