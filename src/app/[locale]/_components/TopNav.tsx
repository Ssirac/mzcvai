"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";

const LOCALES = ["az", "de", "en"] as const;

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="21" x2="21" y2="21" /><rect x="5" y="11" width="3" height="7" rx="1" />
      <rect x="10.5" y="7" width="3" height="11" rx="1" /><rect x="16" y="13" width="3" height="5" rx="1" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}
function IconReview() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export default function TopNav({ active }: { active: "dashboard" | "candidates" | "analytics" | "inbox" | "review" }) {
  const { locale } = useParams() as { locale: string };
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");

  // Unread-reply badge on the inbox tab. Refreshes on mount, every 60s, and when
  // the inbox marks replies read (custom event).
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/inbox/unread")
        .then((r) => r.json())
        .then((d) => { if (alive) setUnread(Number(d?.count ?? 0)); })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    // After replies are marked read (inbox opened or a candidate viewed),
    // re-fetch so the badge reflects the true remaining count.
    window.addEventListener("inbox-read", load);
    return () => { alive = false; clearInterval(id); window.removeEventListener("inbox-read", load); };
  }, []);

  // Mobile burger menu open/closed
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Close the menu whenever the route changes (a tab was followed)
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace(`/${locale}/login`);
  }

  const tabs = [
    { key: "dashboard" as const, href: `/${locale}/dashboard`, label: t("dashboard"), icon: <IconGrid /> },
    { key: "candidates" as const, href: `/${locale}/candidates`, label: t("candidates"), icon: <IconUsers /> },
    { key: "review" as const, href: `/${locale}/review`, label: t("review"), icon: <IconReview /> },
    { key: "inbox" as const, href: `/${locale}/inbox`, label: t("inbox"), icon: <IconInbox /> },
    { key: "analytics" as const, href: `/${locale}/analytics`, label: t("analytics"), icon: <IconChart /> },
  ];

  // Preserve current page when switching language
  function localeHref(l: string) {
    const rest = pathname.replace(/^\/[a-z]{2}/, "");
    return `/${l}${rest || "/dashboard"}`;
  }

  const localeSwitcher = (
    <div className="flex gap-0.5 bg-card-2 rounded-lg p-0.5 border border-line">
      {LOCALES.map((l) => (
        <a
          key={l}
          href={localeHref(l)}
          className={`px-2 py-1 rounded-md text-xs font-medium ${
            locale === l ? "bg-line-strong text-ink" : "text-ink-3 hover:text-ink"
          }`}
        >
          {l.toUpperCase()}
        </a>
      ))}
    </div>
  );

  const logoutBtn = (full: boolean) => (
    <button
      onClick={logout}
      title={t("logout")}
      className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-3 py-2"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      {full && <span>{t("logout")}</span>}
    </button>
  );

  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        {/* Brand */}
        <a href={`/${locale}/dashboard`} className="flex items-center gap-2.5 shrink-0 group">
          <span className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-emerald-500/20 ring-1 ring-white/10 transition-transform group-hover:scale-105">MZ</span>
          <span className="flex flex-col leading-none">
            <span className="text-ink font-semibold text-sm tracking-tight">Talent Intelligence</span>
            <span className="hidden sm:block text-ink-3 text-[10px] tracking-wide">MZ Personalvermittlung</span>
          </span>
        </a>

        {/* Desktop tabs (md+) */}
        <div className="hidden md:flex items-center gap-1 ml-2">
          {tabs.map((tab) => {
            const isActive = active === tab.key;
            return (
              <a
                key={tab.key}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                title={tab.label}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "text-ink-2 hover:text-ink hover:bg-card-2"
                }`}
              >
                <span className="relative">
                  {tab.icon}
                  {tab.key === "inbox" && unread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-green-500 text-white text-[10px] font-bold leading-none">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </span>
                <span>{tab.label}</span>
              </a>
            );
          })}
        </div>

        {/* Desktop right controls (md+) */}
        <div className="hidden md:flex ml-auto items-center gap-3">
          {localeSwitcher}
          <ThemeToggle />
          {logoutBtn(true)}
        </div>

        {/* Mobile controls (< md): theme toggle + hamburger */}
        <div className="md:hidden ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menyu"
            aria-expanded={menuOpen}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-card-2 border border-line-strong text-ink-2 hover:text-ink"
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
            {!menuOpen && unread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-green-500 text-white text-[10px] font-bold leading-none ring-2 ring-surface">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden">
          <div className="fixed inset-x-0 top-14 bottom-0 z-20 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 right-0 top-14 z-30 border-b border-line bg-surface shadow-xl animate-[slideIn_0.16s_ease-out]">
            <div className="px-3 py-3 space-y-1">
              {tabs.map((tab) => {
                const isActive = active === tab.key;
                return (
                  <a
                    key={tab.key}
                    href={tab.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                        : "text-ink-2 hover:text-ink hover:bg-card-2"
                    }`}
                  >
                    <span className="relative">
                      {tab.icon}
                      {tab.key === "inbox" && unread > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-green-500 text-white text-[10px] font-bold leading-none">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </span>
                    <span>{tab.label}</span>
                  </a>
                );
              })}
              <div className="flex items-center justify-between gap-2 pt-3 mt-2 border-t border-line">
                {localeSwitcher}
                {logoutBtn(true)}
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
