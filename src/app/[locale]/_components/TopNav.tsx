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
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconList() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
function IconReport() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function TopNav({ active }: { active: "dashboard" | "candidates" | "analytics" | "report" | "inbox" | "review" | "captcha" | "outreachReview" | "applications" | "system" }) {
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

  // Robot-confirmation badge on the captcha tab — items waiting for a human to
  // clear a captcha/OTP so an application can proceed.
  const [robotCount, setRobotCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/captcha-queue/count")
        .then((r) => r.json())
        .then((d) => { if (alive) setRobotCount(Number(d?.count ?? 0)); })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
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
    { key: "captcha" as const, href: `/${locale}/captcha-queue`, label: t("captcha"), icon: <IconShield /> },
    { key: "applications" as const, href: `/${locale}/applications`, label: t("applications"), icon: <IconList /> },
    { key: "inbox" as const, href: `/${locale}/inbox`, label: t("inbox"), icon: <IconInbox /> },
    { key: "analytics" as const, href: `/${locale}/analytics`, label: t("analytics"), icon: <IconChart /> },
    { key: "report" as const, href: `/${locale}/report`, label: t("report"), icon: <IconReport /> },
    { key: "system" as const, href: `/${locale}/system`, label: t("system"), icon: <IconCog /> },
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

  // `responsive` = top-bar logout: show the label only from xl up so the bar
  // stays compact on laptop widths (the icon + tooltip carry it below xl).
  const logoutBtn = (full: boolean, responsive = false) => (
    <button
      onClick={logout}
      title={t("logout")}
      className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-2.5 py-2"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      {full && <span className={responsive ? "hidden 2xl:inline" : ""}>{t("logout")}</span>}
    </button>
  );

  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        {/* Brand */}
        <a href={`/${locale}/dashboard`} className="flex items-center gap-2.5 shrink-0 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.jpeg" alt="MZ" className="w-8 h-8 rounded-xl object-cover shadow-lg ring-1 ring-white/10 transition-transform group-hover:scale-105" />
          <span className="flex flex-col leading-none">
            <span className="text-ink font-semibold text-sm tracking-tight">Talent Intelligence</span>
            <span className="hidden sm:block text-ink-3 text-[10px] tracking-wide">MZ Personalvermittlung</span>
          </span>
        </a>

        {/* Desktop tabs — lg+ (tablets/small laptops use the hamburger). Icon-only
            through the laptop range so all 8 fit; labels appear only from 2xl
            (≥1536px) up, where there's genuinely room for them. */}
        <div className="hidden lg:flex items-center gap-0.5 2xl:gap-1 ml-1 2xl:ml-2 min-w-0">
          {tabs.map((tab) => {
            const isActive = active === tab.key;
            return (
              <a
                key={tab.key}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                title={tab.label}
                className={`flex items-center gap-2 px-2.5 2xl:px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
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
                  {tab.key === "captcha" && robotCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none animate-pulse">
                      {robotCount > 99 ? "99+" : robotCount}
                    </span>
                  )}
                </span>
                <span className="hidden 2xl:inline">{tab.label}</span>
              </a>
            );
          })}
        </div>

        {/* Desktop right controls — lg+ */}
        <div className="hidden lg:flex ml-auto items-center gap-2 2xl:gap-3">
          {localeSwitcher}
          <ThemeToggle />
          {logoutBtn(true, true)}
        </div>

        {/* Mobile/tablet controls (< lg): theme toggle + hamburger */}
        <div className="lg:hidden ml-auto flex items-center gap-2">
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
        <div className="lg:hidden">
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
