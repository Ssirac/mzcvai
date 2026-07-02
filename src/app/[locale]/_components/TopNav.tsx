"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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

export default function TopNav({ active }: { active: "dashboard" | "candidates" | "analytics" | "inbox" }) {
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace(`/${locale}/login`);
  }

  const tabs = [
    { key: "dashboard" as const, href: `/${locale}/dashboard`, label: t("dashboard"), icon: <IconGrid /> },
    { key: "candidates" as const, href: `/${locale}/candidates`, label: t("candidates"), icon: <IconUsers /> },
    { key: "inbox" as const, href: `/${locale}/inbox`, label: t("inbox"), icon: <IconInbox /> },
    { key: "analytics" as const, href: `/${locale}/analytics`, label: t("analytics"), icon: <IconChart /> },
  ];

  // Preserve current page when switching language
  function localeHref(l: string) {
    const rest = pathname.replace(/^\/[a-z]{2}/, "");
    return `/${l}${rest || "/dashboard"}`;
  }

  return (
    <nav className="sticky top-0 z-30 border-b border-gray-800 bg-gray-950/80 backdrop-blur supports-[backdrop-filter]:bg-gray-950/60">
      <div className="px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        {/* Brand */}
        <a href={`/${locale}/dashboard`} className="flex items-center gap-2 shrink-0">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm shadow">GCC</span>
          <span className="hidden md:block text-white font-semibold text-sm">Germany Career Center</span>
        </a>

        {/* Primary tabs — prominent. On phones only the active tab shows its
            label (others collapse to icons) so the bar fits a narrow screen. */}
        <div className="flex items-center gap-0.5 sm:gap-1 ml-0.5 sm:ml-2">
          {tabs.map((tab) => {
            const isActive = active === tab.key;
            return (
              <a
                key={tab.key}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                title={tab.label}
                className={`flex items-center gap-2 px-2.5 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/60"
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
                <span className={isActive ? "inline" : "hidden md:inline"}>{tab.label}</span>
              </a>
            );
          })}
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="flex gap-0.5 bg-gray-900 rounded-lg p-0.5 border border-gray-800">
            {LOCALES.map((l) => (
              <a
                key={l}
                href={localeHref(l)}
                className={`px-1.5 sm:px-2 py-1 rounded-md text-xs font-medium ${
                  locale === l ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"
                }`}
              >
                {l.toUpperCase()}
              </a>
            ))}
          </div>
          <button
            onClick={logout}
            title={t("logout")}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg px-2.5 sm:px-3 py-2"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="hidden sm:inline">{t("logout")}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
