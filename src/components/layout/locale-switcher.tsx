"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { useParams } from "next/navigation";
import { useRouter, usePathname } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: string) {
    startTransition(() => {
      router.replace(
        // @ts-expect-error -- pathname has dynamic segments typed
        { pathname, params },
        { locale: next }
      );
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 disabled:opacity-50"
          disabled={isPending}
          aria-label="Language"
        >
          {locale === "zh" ? "中文" : "English"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => switchTo("zh")}>
          中文
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => switchTo("en")}>
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
