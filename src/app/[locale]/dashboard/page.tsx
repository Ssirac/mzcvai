"use client";

import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { BERUF_LIST, REGIONS_DE } from "@/lib/berufMap";
import TopNav from "../_components/TopNav";
import { useToast } from "../_components/Toast";

interface Stats {
  newEmployers: number;
  newVacancies: number;
  sponsorshipReady: number;
  berufBreakdown: { beruf: string; count: number }[];
  topEmployers: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    score: number;
    sponsorshipSignal: string;
    scoreBreakdown: Record<string, unknown> | null;
    _count: { vacancies: number };
  }[];
  recentVacancies: {
    id: string;
    title: string;
    beruf: string;
    region: string;
    url: string | null;
    source: string;
    foundAt: string;
    employer: { name: string; genericEmail: string | null; sponsorshipSignal: string };
  }[];
}

interface OutreachItem {
  id: string;
  status: string;
  subject: string | null;
  draftBody: string;
  toAddress: string | null;
  match: {
    candidate: { name: string; beruf: string };
    employer: { name: string; city: string | null; sponsorshipSignal: string };
    vacancy: { title: string; region: string };
  };
}

const SIGNAL_COLOR: Record<string, string> = {
  YES: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  LIKELY: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  UNKNOWN: "bg-gray-500/20 text-gray-400 border border-gray-600/30",
  NO: "bg-red-500/20 text-red-400 border border-red-500/30",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-yellow-500/20 text-yellow-300",
  APPROVED: "bg-blue-500/20 text-blue-300",
  SENT: "bg-emerald-500/20 text-emerald-300",
  OPENED: "bg-purple-500/20 text-purple-300",
  REPLIED: "bg-green-500/20 text-green-300",
  BOUNCED: "bg-red-500/20 text-red-400",
};

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const toast = useToast();

  const [stats, setStats] = useState<Stats | null>(null);
  const [outreaches, setOutreaches] = useState<OutreachItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [ingestForm, setIngestForm] = useState({ beruf: "Housekeeping", region: "Deutschland", source: "all" });
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [expandedScore, setExpandedScore] = useState<string | null>(null);
  const [sources, setSources] = useState<{ id: string; label: string; category: string; available: boolean; reason: string | null }[]>([]);
  const [jobSearch, setJobSearch] = useState("");
  const [bounce, setBounce] = useState<{ rate: number; count: number; sent: number } | null>(null);

  async function fetchStats() {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/employers/stats");
      const data = await res.json();
      setStats(data);
    } finally {
      setStatsLoading(false);
    }
  }

  async function fetchOutreaches() {
    const res = await fetch("/api/outreach?status=DRAFT");
    const data = await res.json();
    setOutreaches(data.outreaches ?? []);
  }

  async function fetchSources() {
    try {
      const res = await fetch("/api/ingest");
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch { /* non-fatal */ }
  }

  async function fetchBounce() {
    try {
      const res = await fetch("/api/analytics");
      const data = await res.json();
      if (data?.funnel) {
        setBounce({ rate: data.funnel.bounceRate ?? 0, count: data.funnel.bounced ?? 0, sent: data.funnel.sent ?? 0 });
      }
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    fetchStats();
    fetchOutreaches();
    fetchSources();
    fetchBounce();
  }, []);

  async function runIngest() {
    setIngestLoading(true);
    setIngestResult(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beruf: ingestForm.beruf, region: ingestForm.region, source: ingestForm.source }),
      });
      const data = await res.json();
      setIngestResult(
        data.ok
          ? `+${data.vacanciesNew} ${t("vacancy")} / +${data.employersNew} ${t("newEmployers")} / ${data.employersScored} ✓`
          : `⚠ ${data.error}`
      );
      if (data.ok) fetchStats();
    } finally {
      setIngestLoading(false);
    }
  }

  async function runEnrich() {
    setEnrichLoading(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 12, beruf: ingestForm.beruf, region: ingestForm.region }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(`${t("enrichDone")}: +${data.enriched ?? 0} · ${data.chainMatched ?? 0} · ${data.skipped ?? 0}`, "success");
        fetchStats();
      } else {
        toast(data.error ?? "error", "error");
      }
    } finally {
      setEnrichLoading(false);
    }
  }

  const [cleanupLoading, setCleanupLoading] = useState(false);
  async function cleanupPartTime() {
    setCleanupLoading(true);
    try {
      const [ptRes, exRes] = await Promise.all([
        fetch("/api/cleanup-parttime", { method: "POST" }).then((r) => r.json()),
        fetch("/api/cleanup-expired", { method: "POST" }).then((r) => r.json()),
      ]);
      const pt = Number(ptRes?.partTimeDeleted ?? 0);
      const ex = Number(exRes?.expiredDeleted ?? 0);
      toast(`${pt} part-time/mini-job + ${ex} köhnə elan silindi`, "success");
      fetchStats();
    } finally {
      setCleanupLoading(false);
    }
  }

  async function approveOutreach(id: string) {
    await fetch(`/api/outreach/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", userId: "dashboard-user" }),
    });
    fetchOutreaches();
  }

  async function sendOutreach(id: string) {
    const res = await fetch(`/api/outreach/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send" }),
    });
    const data = await res.json();
    if (data.ok) toast(t("status.SENT"), "success");
    else toast(data.error, "error");
    fetchOutreaches();
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <TopNav active="dashboard" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3">
          <span className="w-1 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-teal-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
            <p className="text-sm text-gray-500">{t("subtitle")}</p>
          </div>
        </div>


        {/* Deliverability alert — high bounce rate threatens domain reputation */}
        {bounce && bounce.sent >= 20 && bounce.rate >= 5 && (
          <div className="flex items-start gap-3 bg-red-950/40 border border-red-800/50 rounded-2xl p-4">
            <span className="text-xl leading-none">⚠️</span>
            <div className="text-sm">
              <div className="font-semibold text-red-300">Çatdırılma xəbərdarlığı — bounce faizi yüksəkdir ({bounce.rate}%)</div>
              <p className="text-red-200/70 text-xs mt-0.5 leading-relaxed">
                {bounce.count} / {bounce.sent} mail çatmadı. Yüksək bounce domeninizin reputasiyasını zədələyir və maillərin spam-a düşməsinə səbəb olur.
                Email doğrulamanın açıq olduğundan (VERIFY_EMAILS=true) əmin olun və gündəlik göndərmə sayını azaldın.
              </p>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: t("newEmployers"), value: stats?.newEmployers, color: "text-blue-400", glow: "from-blue-500/10" },
            { label: t("newVacancies"), value: stats?.newVacancies, color: "text-violet-400", glow: "from-violet-500/10" },
            { label: t("sponsorshipReady"), value: stats?.sponsorshipReady, color: "text-emerald-400", glow: "from-emerald-500/10" },
          ].map((card) => (
            <div key={card.label} className={`relative bg-gradient-to-br ${card.glow} to-transparent bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 overflow-hidden`}>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                {t("tonight")} — {card.label}
              </div>
              <div className={`text-3xl sm:text-4xl font-bold ${card.color}`}>
                {statsLoading ? "—" : card.value ?? 0}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">

          {/* Beruf breakdown */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("byBeruf")}</h3>
            {statsLoading ? (
              <div className="text-gray-500 text-sm">{t("running")}</div>
            ) : (stats?.berufBreakdown ?? []).length === 0 ? (
              <div className="text-gray-500 text-sm">{t("noData")}</div>
            ) : (
              <div className="space-y-2">
                {(stats?.berufBreakdown ?? []).map((b) => (
                  <div key={b.beruf} className="flex items-center gap-2">
                    <div className="text-sm text-gray-300 w-24 sm:w-32 truncate">{b.beruf}</div>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{
                          width: `${Math.min(
                            100,
                            (b.count / Math.max(...(stats?.berufBreakdown ?? []).map((x) => x.count), 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 w-8 text-right">{b.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ingest trigger */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("ingest")}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">{t("beruf")} <span className="text-gray-600">({t("occupationHint")})</span></label>
                <input
                  list="beruf-options"
                  value={ingestForm.beruf}
                  onChange={(e) => setIngestForm((f) => ({ ...f, beruf: e.target.value }))}
                  placeholder="Koch, Pflege, LKW-Fahrer, Schweißer..."
                  className="w-full bg-gray-800 text-white rounded px-2 py-2 text-sm mt-1"
                />
                <datalist id="beruf-options">
                  {BERUF_LIST.map((b) => <option key={b} value={b} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("region")}</label>
                <select
                  value={ingestForm.region}
                  onChange={(e) => setIngestForm((f) => ({ ...f, region: e.target.value }))}
                  className="w-full bg-gray-800 text-white rounded px-2 py-2 text-sm mt-1"
                >
                  {REGIONS_DE.map((r) => (
                    <option key={r} value={r}>{r === "Deutschland" ? t("allGermany") : r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("source")}</label>
                <select
                  value={ingestForm.source}
                  onChange={(e) => setIngestForm((f) => ({ ...f, source: e.target.value }))}
                  className="w-full bg-gray-800 text-white rounded px-2 py-2 text-sm mt-1"
                >
                  <option value="all">{t("sourceAll")}</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.available}>
                      {s.available ? "✓" : "🔒"} {s.label}{!s.available ? " — " + t("sourceLocked") : ""}
                    </option>
                  ))}
                </select>
                {sources.length > 0 && (
                  <div className="text-[10px] text-gray-600 mt-1">
                    {sources.filter((s) => s.available).length} {t("sourcesActive")} · {sources.filter((s) => !s.available).length} {t("sourcesPlanned")}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={runIngest}
                  disabled={ingestLoading || enrichLoading || !ingestForm.beruf.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-2.5 text-sm font-medium"
                >
                  {ingestLoading ? t("running") : t("run")}
                </button>
                <button
                  onClick={runEnrich}
                  disabled={enrichLoading || ingestLoading}
                  title={t("enrichHint")}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 active:bg-gray-900 border border-gray-700 disabled:opacity-50 text-gray-200 rounded px-3 py-2.5 text-sm font-medium"
                >
                  {enrichLoading ? t("running") : t("enrich")}
                </button>
              </div>
              <button
                onClick={cleanupPartTime}
                disabled={cleanupLoading || ingestLoading}
                title="Part-time / mini-job və 30 gündən köhnə elanları bazadan silir"
                className="w-full bg-red-900/30 hover:bg-red-900/50 border border-red-800/40 disabled:opacity-50 text-red-300 rounded px-3 py-2 text-xs font-medium"
              >
                {cleanupLoading ? t("running") : "🧹 Part-time + köhnə elanları sil"}
              </button>
              {ingestResult && (
                <div className={`text-xs p-2 rounded ${ingestResult.startsWith("⚠") ? "bg-red-900/30 text-red-400" : "bg-emerald-900/30 text-emerald-400"}`}>
                  {ingestResult}
                </div>
              )}
            </div>
          </div>

          {/* Outreach queue summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("outreachQueue")}</h3>
            {outreaches.length === 0 ? (
              <div className="text-gray-500 text-sm">{t("noData")}</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {outreaches.slice(0, 5).map((o) => (
                  <div key={o.id} className="bg-gray-800 rounded p-2 text-xs">
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-medium text-white truncate">
                        {o.match.employer.name}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${STATUS_COLOR[o.status] ?? ""}`}>
                        {o.status}
                      </span>
                    </div>
                    <div className="text-gray-400 mt-0.5 truncate">{o.match.candidate.name} → {o.match.vacancy.title}</div>
                    <div className="flex gap-2 mt-2">
                      {o.status === "DRAFT" && (
                        <button
                          onClick={() => approveOutreach(o.id)}
                          className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-[10px]"
                        >
                          {t("approve")}
                        </button>
                      )}
                      {o.status === "APPROVED" && (
                        <button
                          onClick={() => sendOutreach(o.id)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[10px]"
                        >
                          {t("send")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recently found jobs — full-time listings with direct links */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">{t("recentJobs")}</h3>
              <p className="text-[11px] text-gray-600">{t("recentJobsHint")}</p>
            </div>
            <div className="relative w-full sm:w-72">
              <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder={t("searchJobs")}
                className="w-full bg-gray-950 border border-gray-800 focus:border-emerald-600/50 focus:outline-none text-white rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-gray-600"
              />
            </div>
          </div>

          {statsLoading ? (
            <div className="text-gray-500 text-sm py-6 text-center">{t("running")}</div>
          ) : (() => {
            const q = jobSearch.trim().toLowerCase();
            const jobs = (stats?.recentVacancies ?? []).filter((v) =>
              !q ||
              v.title.toLowerCase().includes(q) ||
              v.employer.name.toLowerCase().includes(q) ||
              (v.region ?? "").toLowerCase().includes(q) ||
              (v.beruf ?? "").toLowerCase().includes(q)
            );
            if (jobs.length === 0) {
              return <div className="text-gray-500 text-sm py-6 text-center">{t("noData")}</div>;
            }
            return (
              <ul className="divide-y divide-gray-800/70 -mx-1">
                {jobs.map((v) => (
                  <li key={v.id} className="group flex items-center gap-3 px-1 py-2.5 hover:bg-gray-800/30 rounded-lg transition-colors">
                    {/* email-availability dot */}
                    <span
                      className={`shrink-0 w-2 h-2 rounded-full ${v.employer.genericEmail ? "bg-emerald-400" : "bg-gray-600"}`}
                      title={v.employer.genericEmail ? t("emailReady") : t("noEmailYet")}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate max-w-full">{v.title}</span>
                        {v.employer.sponsorshipSignal === "YES" && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">★ Sponsor</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {v.employer.name} · {v.region}
                        <span className="text-gray-700"> — {v.beruf}</span>
                      </div>
                    </div>
                    {v.url ? (
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-blue-300 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-600/25 rounded-lg px-2.5 py-1.5 transition-colors"
                      >
                        {t("viewListing")}
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M7 17 17 7M7 7h10v10" />
                        </svg>
                      </a>
                    ) : (
                      <span className="shrink-0 text-[11px] text-gray-600">{t("noData")}</span>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>

        {/* Top employers table */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">{t("topEmployers")}</h3>
          {statsLoading ? (
            <div className="text-gray-500 text-sm">{t("running")}</div>
          ) : (stats?.topEmployers ?? []).length === 0 ? (
            <div className="text-gray-500 text-sm">{t("noData")}</div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="text-left pb-2">{t("topEmployers")}</th>
                    <th className="text-left pb-2">{t("signal")}</th>
                    <th className="text-right pb-2">{t("score")}</th>
                    <th className="text-right pb-2">{t("vacancy")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {(stats?.topEmployers ?? []).map((emp) => (
                    <Fragment key={emp.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-800/50"
                        onClick={() => setExpandedScore(expandedScore === emp.id ? null : emp.id)}
                      >
                        <td className="py-2.5">
                          <div className="font-medium text-white">{emp.name}</div>
                          <div className="text-xs text-gray-500">{emp.city}, {emp.region}</div>
                        </td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${SIGNAL_COLOR[emp.sponsorshipSignal] ?? ""}`}>
                            {emp.sponsorshipSignal}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 sm:w-20 bg-gray-800 rounded-full h-1.5 hidden sm:block">
                              <div
                                className="bg-emerald-500 h-1.5 rounded-full"
                                style={{ width: `${emp.score}%` }}
                              />
                            </div>
                            <span className="font-bold text-white w-8">{emp.score}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right text-gray-400">{emp._count.vacancies}</td>
                      </tr>
                      {expandedScore === emp.id && emp.scoreBreakdown && (
                        <tr>
                          <td colSpan={4} className="py-2 px-2 sm:px-4 bg-gray-800/50 text-xs">
                            <div className="grid grid-cols-5 gap-2 sm:gap-3 text-center py-2">
                              {["sponsorship", "vacancy", "channel", "behavior", "context"].map((key) => (
                                <div key={key}>
                                  <div className="text-gray-500 uppercase text-[10px]">{t(key as never)}</div>
                                  <div className="text-white font-bold text-base sm:text-lg">
                                    {(emp.scoreBreakdown as Record<string, number>)?.[key] ?? 0}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {Array.isArray((emp.scoreBreakdown as Record<string, unknown>)?.signals) && (
                              <ul className="text-gray-400 space-y-0.5 mt-1">
                                {((emp.scoreBreakdown as Record<string, string[]>).signals ?? []).map((s, i) => (
                                  <li key={i}>• {s}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
