import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session-core";
import { appBaseDomain, slugFromHost } from "./lib/app-domain";

const intlMiddleware = createIntlMiddleware(routing);

// 私有路由（工作区）：未登录访问 → 登录页并携带 redirect
const PROTECTED = /^\/(zh|en)\/(dashboard|chat|profile)(\/|$)/;

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim();

  // 应用独立域名：slug.apps.example.com/* → /p/slug/*
  const appSlug = slugFromHost(host);
  if (appSlug) {
    const url = req.nextUrl.clone();
    url.pathname = `/p/${appSlug}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // 平台域 /p/{slug} → 独立子域（未配置 APP_BASE_DOMAIN 时保留路径代理）
  if (pathname === "/p" || pathname.startsWith("/p/")) {
    const base = appBaseDomain();
    if (base) {
      const rest = pathname.replace(/^\/p\/?/, "");
      const [slug, ...tail] = rest.split("/");
      if (slug) {
        const url = req.nextUrl.clone();
        url.hostname = `${slug.toLowerCase()}.${base}`;
        url.pathname = tail.length ? `/${tail.join("/")}` : "/";
        const proto = (req.headers.get("x-forwarded-proto") ?? url.protocol)
          .replace(/:$/, "")
          .split(",")[0]
          .trim();
        url.protocol = `${proto}:`;
        return NextResponse.redirect(url, 307);
      }
    }
    return NextResponse.next();
  }

  // 平台 API 的跨源写操作防护（Cookie 已由 SameSite + 独立域隔离，这里做纵深防御）
  if (pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.get("origin");
      if (origin) {
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = null;
        }
        if (originHost !== host) {
          return new NextResponse("forbidden_origin", { status: 403 });
        }
      }
    }
    return NextResponse.next();
  }

  // 平台静态文件（favicon、robots 等）不进入 i18n 路由
  if (pathname.includes(".")) {
    return NextResponse.next();
  }

  const localeMatch = /^\/(zh|en)(\/|$)/.exec(pathname);
  if (localeMatch && PROTECTED.test(pathname)) {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = `/${localeMatch[1]}/login`;
      url.search = `?redirect=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  return intlMiddleware(req);
}

export const config = {
  // 跳过：Next 内部资源与平台预览代理
  matcher: ["/((?!_next|_vercel|preview(?:/|$)).*)"],
};