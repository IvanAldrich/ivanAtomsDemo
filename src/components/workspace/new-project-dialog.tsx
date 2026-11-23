"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function NewProjectDialog() {
  const t = useTranslations("workspace");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, prompt: prompt || undefined }),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { project: { id: string } };
      setOpen(false);
      router.push(`/${locale}/chat/${data.project.id}`);
    } catch {
      setError("network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700">
          {t("newProject")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("newProject")}</DialogTitle>
        <DialogDescription>{t("emptyDesc")}</DialogDescription>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              {t("projectNameLabel")}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("projectNamePlaceholder")}
              maxLength={120}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              {t("promptLabel")}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("promptPlaceholder")}
              rows={4}
              maxLength={20000}
              className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700"
            >
              {t("cancel")}
            </button>
            <button
              onClick={create}
              disabled={pending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? t("creating") : t("create")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
