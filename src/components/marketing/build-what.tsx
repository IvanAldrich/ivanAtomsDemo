"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { HeroPrompt } from "./hero-prompt";

const CATEGORIES = [
  { id: "landing", demo: "/demos/landing/index.html" },
  { id: "brand", demo: "/demos/brand/index.html" },
  { id: "webapp", demo: "/demos/webapp/index.html" },
  { id: "game", demo: "/demos/game/index.html" },
  { id: "dashboard", demo: "/demos/dashboard/index.html" },
  { id: "portfolio", demo: "/demos/portfolio/index.html" },
] as const;

export function BuildWhatSection({ isLoggedIn }: { isLoggedIn: boolean }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const router = useRouter();
  const [active, setActive] = useState<(typeof CATEGORIES)[number] | null>(null);
  const [cloning, setCloning] = useState(false);

  async function clone(category: (typeof CATEGORIES)[number]) {
    if (!isLoggedIn) {
      router.push(
        `/${locale}/login?redirect=${encodeURIComponent(`/${locale}`)}`
      );
      return;
    }
    setCloning(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: t(`category.${category.id}.prompt`) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { project: { id: string } };
      router.push(`/${locale}/chat/${data.project.id}`);
    } finally {
      setCloning(false);
    }
  }

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold text-neutral-900">
          {t("buildWhat")}
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c)}
              className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="h-36 overflow-hidden border-b border-neutral-100 bg-neutral-50">
                <iframe
                  src={c.demo}
                  sandbox="allow-scripts"
                  scrolling="no"
                  className="pointer-events-none h-[400px] w-[800px] origin-top-left scale-[0.5]"
                  title={t(`category.${c.id}.title`)}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-neutral-900">
                  {t(`category.${c.id}.title`)}
                </span>
                <span className="text-xs text-brand-600 group-hover:underline">
                  {t("previewAction")}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Dialog open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-4xl">
          {active && (
            <>
              <DialogTitle>{t(`category.${active.id}.title`)}</DialogTitle>
              <DialogDescription>
                {t(`category.${active.id}.desc`)}
              </DialogDescription>
              <div className="mt-4 h-[420px] overflow-hidden rounded-lg border border-neutral-200">
                <iframe
                  src={active.demo}
                  sandbox="allow-scripts allow-forms"
                  className="h-full w-full"
                  title={t(`category.${active.id}.title`)}
                />
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => clone(active)}
                  disabled={cloning}
                  className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {cloning ? "…" : t("clone")}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export { HeroPrompt };
