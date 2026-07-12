"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";
import { jsonFetch } from "@/lib/clientApi";

interface AppRow {
  id: string;
  candidateName: string;
  company: string;
  position: string;
  link: string;
  source: string;
  status: string;
  updatedAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  APPLIED: "bg-emerald-600/15 text-emerald-500",
  ALREADY_APPLIED: "bg-card-2 text-ink-3",
  WAITING_CAPTCHA: "bg-red-500/15 text-red-500",
  WAITING_OTP: "bg-amber-500/15 text-amber-500",
  FORM_FOUND: "bg-sky-500/15 text-sky-500",
  ERROR: "bg-rose-500/15 text-rose-500",
  INTERVIEW: "bg-violet-500/15 text-violet-500",
  OFFER: "bg-emerald-600/20 text-emerald-400",
};

export default function ApplicationsPage() {
  const t = useTranslations("applications");
  const [items, setItems] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await jsonFetch("/api/applications");
    setItems((data.items as AppRow[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="applications" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-indigo-400 to-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-ink flex items-center gap-2">
                {t("title")}
                {!loading && items.length > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">{items.length}</span>
                )}
              </h1>
              <p className="text-xs text-ink-3">{t("subtitle")}</p>
            </div>
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="text-sm text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-3 py-2 disabled:opacity-50">
            {t("refresh")}
          </button>
        </div>

        {loading ? (
          <div className="text-center text-ink-3 py-16 text-sm">…</div>
        ) : items.length === 0 ? (
          <div className="text-center text-ink-3 py-16 text-sm border border-dashed border-line rounded-xl">{t("empty")}</div>
        ) : (
          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-ink-3 text-xs border-b border-line">
                  <th className="px-3 py-2 font-medium">{t("candidate")}</th>
                  <th className="px-3 py-2 font-medium">{t("position")}</th>
                  <th className="px-3 py-2 font-medium">{t("company")}</th>
                  <th className="px-3 py-2 font-medium">{t("source")}</th>
                  <th className="px-3 py-2 font-medium">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-line/60 hover:bg-card-2">
                    <td className="px-3 py-2 text-ink">{it.candidateName}</td>
                    <td className="px-3 py-2 text-ink-2">
                      <a href={it.link} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{it.position}</a>
                    </td>
                    <td className="px-3 py-2 text-ink-2">{it.company}</td>
                    <td className="px-3 py-2 text-ink-3">{it.source}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[it.status] ?? "bg-card-2 text-ink-2"}`}>
                        {it.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
