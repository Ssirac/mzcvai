"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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

export default function TopNav({ active }: { active: "dashboard" | "candidates" }) {
  const { locale } = useParams() as { locale: string };
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace(`/${locale}/login`);
  }

  const tabs = [
    { key: "dashboard" as const, href: `/${locale}/dashboard`, label: t("dashboard"), icon: <IconGrid /> },
    { key: "candidates" as const, href: `/${locale}/candidates`, label: t("candidates"), icon: <IconUsers /> },
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
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm shadow">MZ</span>
          <span className="hidden md:block text-white font-semibold text-sm">Talent Intelligence</span>
        </a>

        {/* Primary tabs — prominent */}
        <div className="flex items-center gap-1 ml-1 sm:ml-2">
          {tabs.map((tab) => {
            const isActive = active === tab.key;
            return (
              <a
                key={tab.key}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
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
