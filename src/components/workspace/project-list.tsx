"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export type ProjectRow = {
  id: string;
  title: string;
  status: string;
  publishedSlug: string | null;
  updatedAt: string;
};

const IN_FLIGHT = new Set(["queued", "generating", "building", "repairing"]);

function statusClass(status: string) {
  if (IN_FLIGHT.has(status)) return "bg-amber-50 text-amber-700";
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-red-50 text-red-600";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

export function ProjectList({ initialProjects }: { initialProjects: ProjectRow[] }) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        router.refresh();
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center">
        <h2 className="text-lg font-semibold text-neutral-900">
          {t("emptyTitle")}
        </h2>
        <p className="mt-2 text-sm text-neutral-500">{t("emptyDesc")}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/chat/${project.id}`}
                  className="truncate text-sm font-medium text-neutral-900 hover:text-brand-700"
                >
                  {project.title}
                </Link>
                <span
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${statusClass(project.status)}`}
                >
                  {IN_FLIGHT.has(project.status) && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  )}
                  {t(`status.${project.status}`)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-neutral-400">
                {new Date(project.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {project.publishedSlug && (
                <a
                  href={`/p/${project.publishedSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-700 hover:border-brand-300"
                >
                  {t("open")} ↗
                </a>
              )}
              <Link
                href={`/chat/${project.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm hover:border-neutral-300 ${
                  IN_FLIGHT.has(project.status)
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-neutral-200 text-neutral-700"
                }`}
              >
                {IN_FLIGHT.has(project.status) ? t("viewProgress") : t("open")}
              </Link>
              <button
                onClick={() => setDeleteTarget(project)}
                className="rounded-md border border-red-100 px-3 py-1.5 text-sm text-red-600 hover:border-red-200"
              >
                {t("deleteProject")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle>{t("deleteProject")}</DialogTitle>
          <DialogDescription>{t("deleteConfirm")}</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700"
            >
              {t("cancel")}
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? "…" : t("confirmDelete")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
