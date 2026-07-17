"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";

interface MonthStats {
  sent: number;
  replies: number;
  positiveReplies: number;
  interviews: number;
  newCandidates: number;
  placements: number;
  replyRate: number;
}
interface Report {
  month: string;
  prevMonth: string;
  nextMonth: string | null;
  isCurrentMonth: boolean;
  activeCandidates: number;
  current: MonthStats;
  previous: MonthStats;
}

const MONTHS: Record<string, string[]> = {
  az: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

function monthLabel(key: string, locale: string): string {
  const [y, m] = key.split("-").map(Number);
  const names = MONTHS[locale] ?? MONTHS.en;
  return `${names[(m - 1) % 12]} ${y}`;
}

// Signed delta vs. previous month, coloured. "higher is better" for every metric
// here, so a rise is green and a drop is red.
function Delta({ now, prev }: { now: number; prev: number }) {
  const d = now - prev;
  if (d === 0) return <span className="text-ink-3 text-xs">±0</span>;
  const up = d > 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-emerald-500" : "text-red-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(d)}
    </span>
  );
}

function Card({ label, value, prev, sub, accent }: { label: string; value: number | string; prev?: number; sub?: string; accent?: string }) {
  const t = useTranslations("report");
  return (
    <div className="card p-4 sm:p-5">
      <div className="eyebrow mb-1">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className={`tabular text-3xl font-bold ${accent ?? "text-ink"}`}>{value}</div>
        {typeof prev === "number" && typeof value === "number" && (
          <div className="text-right leading-tight">
            <Delta now={value} prev={prev} />
            <div className="text-[10px] text-ink-3">{t("vsPrev")}</div>
          </div>
        )}
      </div>
      {sub && <div className="text-xs text-ink-3 mt-1">{sub}</div>}
    </div>
  );
}

export default function ReportPage() {
  const t = useTranslations("report");
  const locale = useLocale();
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = month ? `?month=${month}` : "";
    fetch(`/api/report${qs}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  const c = data?.current;
  const p = data?.previous;

  return (
    <div className="min-h-screen bg-surface">
      <div className="print:hidden">
        <TopNav active="report" />
      </div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-9 rounded-full bg-gradient-to-b from-sky-400 to-indigo-600" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">{t("title")}</h1>
              <p className="text-sm text-ink-3">{t("subtitle")}</p>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden self-start sm:self-auto text-sm text-ink-2 hover:text-ink bg-card border border-line rounded-lg px-3 py-2"
          >
            🖨 {t("print")}
          </button>
        </div>

        {/* Month navigator */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => data && setMonth(data.prevMonth)}
            className="print:hidden text-ink-2 hover:text-ink bg-card border border-line rounded-lg px-3 py-1.5 text-sm"
            aria-label={t("prevMonth")}
          >‹</button>
          <div className="text-center min-w-48">
            <div className="text-lg font-semibold text-ink">{data ? monthLabel(data.month, locale) : "—"}</div>
            {data?.isCurrentMonth && <div className="text-[11px] text-ink-3">{t("inProgress")}</div>}
          </div>
          <button
            onClick={() => data?.nextMonth && setMonth(data.nextMonth)}
            disabled={!data?.nextMonth}
            className="print:hidden text-ink-2 hover:text-ink bg-card border border-line rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
            aria-label={t("nextMonth")}
          >›</button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
          </div>
        ) : !c ? (
          <div className="card p-10 text-center text-ink-3">—</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Card label={t("applicationsSent")} value={c.sent} prev={p?.sent} accent="text-ink" />
              <Card label={t("repliesReceived")} value={c.replies} prev={p?.replies} sub={`${t("replyRate")}: ${c.replyRate}%`} accent="text-blue-400" />
              <Card label={t("promisingReplies")} value={c.positiveReplies} prev={p?.positiveReplies} sub={t("promisingHint")} accent="text-emerald-400" />
              <Card label={t("newCandidates")} value={c.newCandidates} prev={p?.newCandidates} accent="text-violet-400" />
              <Card label={t("interviews")} value={c.interviews} prev={p?.interviews} accent="text-sky-400" />
              <Card label={t("placements")} value={c.placements} prev={p?.placements} accent="text-emerald-500" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card label={t("activeCandidates")} value={data!.activeCandidates} accent="text-ink" />
              <Card label={t("replyRate")} value={`${c.replyRate}%`} accent="text-blue-400" sub={`${c.replies} / ${c.sent}`} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
