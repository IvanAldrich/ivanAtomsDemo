import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session-core";

const intlMiddleware = createIntlMiddleware(routing);

// 私有路由（工作区）：未登录访问 → 登录页并携带 redirect
const PROTECTED = /^\/(zh|en)\/(dashboard|chat|profile)(\/|$)/;

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
