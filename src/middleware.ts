import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { verifyToken, SESSION_COOKIE } from "./lib/auth";

const intlMiddleware = createMiddleware(routing);

const LOCALES = routing.locales as readonly string[];

// Paths reachable without a session
function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/auth")) return true;     // login/logout
  if (pathname.startsWith("/api/cron")) return true;     // protected by its own secret
  if (pathname === "/api/health") return true;           // monitoring/uptime check
  if (/^\/(?:[a-z]{2}\/)?login$/.test(pathname)) return true; // login page (with/without locale)
  return false;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api");

  // CSRF defense: a state-changing API call from a browser always carries an
  // Origin header; reject it if it doesn't match our host. (Cron is exempt —
  // it is server-to-server and protected by its own secret.)
  if (isApi && MUTATING.has(req.method) && !pathname.startsWith("/api/cron")) {
    const origin = req.headers.get("origin");
    if (origin) {
      const host = req.headers.get("host");
      try {
        if (new URL(origin).host !== host) {
          return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Bad origin" }, { status: 403 });
      }
    }
  }

  if (!session && !isPublic(pathname)) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const seg = pathname.split("/")[1];
    const locale = LOCALES.includes(seg) ? seg : routing.defaultLocale;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // API routes: auth checked above, skip i18n routing
  if (isApi) return NextResponse.next();

  // Pages: run next-intl routing
  return intlMiddleware(req);
}

export const config = {
  // Run on everything except Next internals and static files
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
