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
  if (pathname.startsWith("/api/webhooks")) return true; // signed/secret-guarded provider callbacks
  if (pathname.startsWith("/api/unsubscribe")) return true; // public opt-out link (UWG)
  if (pathname === "/api/health") return true;           // monitoring/uptime check
  if (/^\/(?:[a-z]{2}\/)?login$/.test(pathname)) return true; // login page (with/without locale)
  // PWA/browser assets — must load pre-login for install + tab icon
  if (pathname === "/manifest.webmanifest" || pathname === "/icon.jpeg" || pathname === "/favicon.ico") return true;
  return false;
}

// Server-to-server callbacks that legitimately carry no browser Origin and are
// guarded by their own secret — exempt from the same-origin CSRF check.
function isServerToServer(pathname: string): boolean {
  return pathname.startsWith("/api/cron") || pathname.startsWith("/api/webhooks");
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api");

  // CSRF defense: a state-changing browser request carries an Origin (or at
  // least a Referer); require one of them to match our host. Server-to-server
  // callbacks (cron, webhooks) are exempt — they carry no Origin and are guarded
  // by their own secret. This closes the "no header at all" bypass for the app's
  // own mutating endpoints.
  if (isApi && MUTATING.has(req.method) && !isServerToServer(pathname)) {
    const host = req.headers.get("host");
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const sourceUrl = origin || referer;
    if (!sourceUrl) {
      return NextResponse.json({ error: "Missing origin" }, { status: 403 });
    }
    try {
      if (new URL(sourceUrl).host !== host) {
        return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Bad origin" }, { status: 403 });
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
