import { Link } from "@/i18n/navigation";
import { pickText, type ContentEntry } from "@/content/entries";

export function ContentList({
  entries,
  locale,
  basePath,
  filters,
  activeFilter,
  filterParam,
}: {
  entries: ContentEntry[];
  locale: string;
  basePath: string;
  filters?: string[];
  activeFilter?: string;
  filterParam?: string;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      {filters && filters.length > 0 && filterParam && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href={basePath}
            className={`rounded-full border px-3 py-1 text-sm ${
              !activeFilter
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-neutral-200 text-neutral-600"
            }`}
          >
            全部
          </Link>
          {filters.map((f) => (
            <Link
              key={f}
              href={`${basePath}?${filterParam}=${encodeURIComponent(f)}`}
              className={`rounded-full border px-3 py-1 text-sm ${
                activeFilter === f
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-neutral-200 text-neutral-600"
              }`}
            >
              {f}
            </Link>
          ))}
        </div>
      )}
      <ul className="space-y-3">
        {entries.map((e) => (
          <li key={e.slug}>
            <Link
              href={`${basePath}/${e.slug}`}
              className="block rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-neutral-900">
                  {pickText(e.title, locale)}
                </h2>
                {e.provider && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    {e.provider}
                  </span>
                )}
                {e.topic && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                    {e.topic}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                {pickText(e.subtitle, locale)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {entries.length === 0 && (
        <p className="py-16 text-center text-neutral-400">（空）</p>
      )}
    </div>
  );
}

export function ContentDetail({
  entry,
  locale,
}: {
  entry: ContentEntry;
  locale: string;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold text-neutral-900">
        {pickText(entry.title, locale)}
      </h1>
      <p className="mt-3 text-lg text-neutral-600">
        {pickText(entry.subtitle, locale)}
      </p>
      <div className="mt-8 space-y-4 text-base leading-relaxed text-neutral-800">
        {pickText(entry.body, locale)
          .split("\n")
          .filter(Boolean)
          .map((para, i) => (
            <p key={i}>{para}</p>
          ))}
      </div>
      <div className="mt-10 rounded-xl border border-brand-100 bg-brand-50 px-5 py-4 text-sm text-brand-800">
        试用：描述你的需求，让 AI 工程师为你生成完整工程 →
        <Link href="/" className="ml-1 font-medium underline">
          开始
        </Link>
      </div>
    </article>
  );
}
