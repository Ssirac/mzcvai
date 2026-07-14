"use client";

import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { BERUF_LIST, REGIONS_DE } from "@/lib/berufMap";
import TopNav from "../_components/TopNav";
import AttentionCard from "../_components/AttentionCard";
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
  YES: "pill pill-emerald",
  LIKELY: "pill pill-blue",
  UNKNOWN: "pill pill-gray",
  NO: "pill pill-red",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "pill pill-amber",
  APPROVED: "pill pill-blue",
  SENT: "pill pill-emerald",
  OPENED: "pill pill-purple",
  REPLIED: "pill pill-emerald",
  BOUNCED: "pill pill-red",
};

interface Funnel {
  sent: number; delivered: number; opened: number; replied: number;
  replyRate: number; deliveryRate: number; openRate: number; bounceRate: number;
}
interface Last30 { sent: number; replied: number; replyRate: number }

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
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [last30, setLast30] = useState<Last30 | null>(null);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

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

  async function fetchAnalytics() {
    try {
      const res = await fetch("/api/analytics");
      const data = await res.json();
      if (data?.funnel) {
        setFunnel(data.funnel);
        setBounce({ rate: data.funnel.bounceRate ?? 0, count: data.funnel.bounced ?? 0, sent: data.funnel.sent ?? 0 });
      }
      if (data?.last30) setLast30(data.last30);
    } catch { /* non-fatal */ } finally { setAnalyticsLoaded(true); }
  }

  useEffect(() => {
    fetchStats();
    fetchOutreaches();
    fetchSources();
    fetchAnalytics();
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
      const ng = Number(ptRes?.nonGermanDeleted ?? 0);
      const ex = Number(exRes?.expiredDeleted ?? 0);
      toast(t("cleanupToast", { pt, ng, ex }), "success");
      fetchStats();
    } finally {
      setCleanupLoading(false);
    }
  }

  async function approveOutreach(id: string) {
    await fetch(`/api/outreach/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
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
    <div className="min-h-screen bg-surface">
      <TopNav active="dashboard" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3">
          <span className="w-1 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-teal-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">{t("title")}</h1>
            <p className="text-sm text-ink-3">{t("subtitle")}</p>
          </div>
        </div>

        <AttentionCard />

        <PipelineFunnel />

        {/* Signature — reply rate readout + live funnel. The reply is the money
            metric, so it opens the console. */}
        <div className="card card-lift p-5 sm:p-6 grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr] lg:items-center">
          <div>
            <div className="eyebrow mb-2">{t("replyRateLabel")}</div>
            {!analyticsLoaded ? (
              <div className="skeleton h-14 w-40" />
            ) : (
              <div className="flex items-end gap-1">
                <span className="tabular text-5xl sm:text-6xl font-bold text-accent leading-none">
                  {funnel?.replyRate ?? 0}
                </span>
                <span className="tabular text-2xl sm:text-3xl text-ink-3 font-semibold leading-none pb-1">%</span>
              </div>
            )}
            <p className="text-sm text-ink-2 mt-3 leading-relaxed">
              {funnel && funnel.sent > 0
                ? t("heroTotal", { replied: funnel.replied, sent: funnel.sent })
                : t("heroEmpty")}
            </p>
            {last30 && last30.sent > 0 && (
              <p className="text-xs text-ink-3 mt-1.5">
                {t("last30")}: <span className="tabular text-ink-2">{last30.replyRate}%</span> ({last30.replied}/{last30.sent})
              </p>
            )}
          </div>

          {/* Funnel: send → deliver → open → reply, narrowing toward the win */}
          <div className="space-y-2.5">
            {(!analyticsLoaded ? [0, 1, 2, 3] : [
              { label: t("fSent"), value: funnel?.sent ?? 0, cls: "bg-line-strong", star: false },
              { label: t("fDelivered"), value: funnel?.delivered ?? 0, cls: "bg-blue-500", star: false },
              { label: t("fOpened"), value: funnel?.opened ?? 0, cls: "bg-violet-500", star: false },
              { label: t("fReply"), value: funnel?.replied ?? 0, cls: "bg-accent", star: true },
            ]).map((s, i) => {
              if (typeof s === "number") {
                return (
                  <div key={s} className="flex items-center gap-3">
                    <div className="w-20 sm:w-24 shrink-0"><div className="skeleton h-3 w-16" /></div>
                    <div className="flex-1 skeleton h-6" />
                    <div className="w-14 shrink-0"><div className="skeleton h-3 w-10 ml-auto" /></div>
                  </div>
                );
              }
              const base = funnel?.sent || 0;
              const pct = base > 0 ? Math.round((s.value / base) * 100) : 0;
              const width = base > 0 && s.value > 0 ? Math.max(pct, 4) : 0;
              return (
                <div key={s.label} className="flex items-center gap-3" style={{ animation: `slideIn 320ms ease ${i * 60}ms both` }}>
                  <div className="w-20 sm:w-24 text-xs text-ink-2 shrink-0 truncate">
                    {s.star && <span className="text-accent">★ </span>}{s.label}
                  </div>
                  <div className="flex-1 h-6 rounded-md bg-card-2 border border-line overflow-hidden">
                    <div className={`h-full ${s.cls} rounded-md`} style={{ width: `${width}%`, transition: "width 500ms ease" }} />
                  </div>
                  <div className="w-16 text-right shrink-0 tabular text-sm text-ink">
                    {s.value}<span className="text-ink-3 text-[11px]"> · {pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deliverability alert — high bounce rate threatens domain reputation */}
        {bounce && bounce.sent >= 20 && bounce.rate >= 5 && (
          <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/30 rounded-2xl p-4">
            <span className="text-xl leading-none">⚠️</span>
            <div className="text-sm">
              <div className="font-semibold pill-red bg-transparent border-0 p-0">{t("deliverTitle", { rate: bounce.rate })}</div>
              <p className="text-ink-2 text-xs mt-0.5 leading-relaxed">
                {t("deliverBody", { count: bounce.count, sent: bounce.sent })}
              </p>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: t("newEmployers"), value: stats?.newEmployers, accent: "bg-blue-500" },
            { label: t("newVacancies"), value: stats?.newVacancies, accent: "bg-violet-500" },
            { label: t("sponsorshipReady"), value: stats?.sponsorshipReady, accent: "bg-accent" },
          ].map((card) => (
            <div key={card.label} className="card card-lift p-4 sm:p-5 relative overflow-hidden">
              <span className={`absolute left-0 top-4 bottom-4 w-1 rounded-full ${card.accent}`} />
              <div className="eyebrow mb-2 pl-2">{t("tonight")} — {card.label}</div>
              {statsLoading ? (
                <div className="skeleton h-9 w-16 ml-2" />
              ) : (
                <div className="tabular text-3xl sm:text-4xl font-bold text-ink pl-2">{card.value ?? 0}</div>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">

          {/* Beruf breakdown */}
          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink-2 mb-3">{t("byBeruf")}</h3>
            {statsLoading ? (
              <div className="space-y-2.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="skeleton h-3 w-24 sm:w-32" />
                    <div className="skeleton h-2 flex-1" />
                    <div className="skeleton h-3 w-6" />
                  </div>
                ))}
              </div>
            ) : (stats?.berufBreakdown ?? []).length === 0 ? (
              <div className="text-ink-3 text-sm">{t("noData")}</div>
            ) : (
              <div className="space-y-2">
                {(stats?.berufBreakdown ?? []).map((b) => (
                  <div key={b.beruf} className="flex items-center gap-2">
                    <div className="text-sm text-ink-2 w-24 sm:w-32 truncate">{b.beruf}</div>
                    <div className="flex-1 bg-card-2 rounded-full h-2">
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
                    <div className="text-xs text-ink-3 w-8 text-right tabular">{b.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ingest trigger */}
          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink-2 mb-3">{t("ingest")}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-ink-3">{t("beruf")} <span className="text-ink-3/70">({t("occupationHint")})</span></label>
                <input
                  list="beruf-options"
                  value={ingestForm.beruf}
                  onChange={(e) => setIngestForm((f) => ({ ...f, beruf: e.target.value }))}
                  placeholder="Koch, Pflege, LKW-Fahrer, Schweißer..."
                  className="field mt-1"
                />
                <datalist id="beruf-options">
                  {BERUF_LIST.map((b) => <option key={b} value={b} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs text-ink-3">{t("region")}</label>
                <select
                  value={ingestForm.region}
                  onChange={(e) => setIngestForm((f) => ({ ...f, region: e.target.value }))}
                  className="field mt-1"
                >
                  {REGIONS_DE.map((r) => (
                    <option key={r} value={r}>{r === "Deutschland" ? t("allGermany") : r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-3">{t("source")}</label>
                <select
                  value={ingestForm.source}
                  onChange={(e) => setIngestForm((f) => ({ ...f, source: e.target.value }))}
                  className="field mt-1"
                >
                  <option value="all">{t("sourceAll")}</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.available}>
                      {s.available ? "✓" : "🔒"} {s.label}{!s.available ? " — " + t("sourceLocked") : ""}
                    </option>
                  ))}
                </select>
                {sources.length > 0 && (
                  <div className="text-[10px] text-ink-3 mt-1">
                    {sources.filter((s) => s.available).length} {t("sourcesActive")} · {sources.filter((s) => !s.available).length} {t("sourcesPlanned")}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={runIngest}
                  disabled={ingestLoading || enrichLoading || !ingestForm.beruf.trim()}
                  className="btn btn-primary flex-1"
                >
                  {ingestLoading ? t("running") : t("run")}
                </button>
                <button
                  onClick={runEnrich}
                  disabled={enrichLoading || ingestLoading}
                  title={t("enrichHint")}
                  className="btn btn-ghost flex-1"
                >
                  {enrichLoading ? t("running") : t("enrich")}
                </button>
              </div>
              <button
                onClick={cleanupPartTime}
                disabled={cleanupLoading || ingestLoading}
                title={t("cleanupTitle")}
                className="w-full pill-red bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50 rounded-lg px-3 py-2 text-xs font-medium"
              >
                {cleanupLoading ? t("running") : "🧹 " + t("cleanupBtn")}
              </button>
              {ingestResult && (
                <div className={`text-xs p-2 rounded-lg border ${ingestResult.startsWith("⚠") ? "bg-red-500/10 border-red-500/30 pill-red" : "bg-accent/10 border-accent/30 text-accent"}`}>
                  {ingestResult}
                </div>
              )}
            </div>
          </div>

          {/* Outreach queue summary */}
          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink-2 mb-3">{t("outreachQueue")}</h3>
            {outreaches.length === 0 ? (
              <div className="text-ink-3 text-sm">{t("noData")}</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {outreaches.slice(0, 5).map((o) => (
                  <div key={o.id} className="bg-card-2 border border-line rounded-lg p-2 text-xs">
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-medium text-ink truncate">
                        {o.match.employer.name}
                      </span>
                      <span className={`shrink-0 ${STATUS_COLOR[o.status] ?? "pill pill-gray"}`}>
                        {o.status}
                      </span>
                    </div>
                    <div className="text-ink-2 mt-0.5 truncate">{o.match.candidate.name} → {o.match.vacancy.title}</div>
                    <div className="flex gap-2 mt-2">
                      {o.status === "DRAFT" && (
                        <button
                          onClick={() => approveOutreach(o.id)}
                          className="btn btn-primary px-2.5 py-1 text-[11px]"
                        >
                          {t("approve")}
                        </button>
                      )}
                      {o.status === "APPROVED" && (
                        <button
                          onClick={() => sendOutreach(o.id)}
                          className="btn btn-primary px-2.5 py-1 text-[11px]"
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
        <div className="card p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">{t("recentJobs")}</h3>
              <p className="text-[11px] text-ink-3">{t("recentJobsHint")}</p>
            </div>
            <div className="relative w-full sm:w-72">
              <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 z-10" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder={t("searchJobs")}
                className="field pl-9"
              />
            </div>
          </div>

          {statsLoading ? (
            <ul className="divide-y divide-line/70 -mx-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex items-center gap-3 px-1 py-2.5">
                  <span className="skeleton w-2 h-2 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3.5 w-2/3" />
                    <div className="skeleton h-3 w-1/3" />
                  </div>
                  <div className="skeleton h-7 w-20 rounded-lg" />
                </li>
              ))}
            </ul>
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
              return (
                <div className="py-10 text-center">
                  <div className="text-3xl mb-2">🔍</div>
                  <div className="text-ink-2 text-sm">{q ? t("noJobsSearch") : t("noJobsYet")}</div>
                </div>
              );
            }
            return (
              <ul className="divide-y divide-line/70 -mx-1">
                {jobs.map((v) => (
                  <li key={v.id} className="group flex items-center gap-3 px-1 py-2.5 hover:bg-card-2 rounded-lg transition-colors">
                    {/* email-availability dot */}
                    <span
                      className={`shrink-0 w-2 h-2 rounded-full ${v.employer.genericEmail ? "bg-accent" : "bg-ink-3"}`}
                      title={v.employer.genericEmail ? t("emailReady") : t("noEmailYet")}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-ink truncate max-w-full">{v.title}</span>
                        {v.employer.sponsorshipSignal === "YES" && (
                          <span className="pill pill-emerald text-[9px]">★ Sponsor</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-3 truncate">
                        {v.employer.name} · {v.region}
                        <span className="text-ink-3/60"> — {v.beruf}</span>
                      </div>
                    </div>
                    {v.url ? (
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-blue-500 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 rounded-lg px-2.5 py-1.5 transition-colors"
                      >
                        {t("viewListing")}
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M7 17 17 7M7 7h10v10" />
                        </svg>
                      </a>
                    ) : (
                      <span className="shrink-0 text-[11px] text-ink-3">{t("noData")}</span>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>

        {/* Top employers table */}
        <div className="card p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-ink-2 mb-4">{t("topEmployers")}</h3>
          {statsLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3.5 w-1/3" />
                    <div className="skeleton h-3 w-1/4" />
                  </div>
                  <div className="skeleton h-5 w-14 rounded-full" />
                  <div className="skeleton h-3 w-16" />
                </div>
              ))}
            </div>
          ) : (stats?.topEmployers ?? []).length === 0 ? (
            <div className="text-ink-3 text-sm">{t("noData")}</div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-ink-3 text-xs uppercase border-b border-line">
                    <th className="text-left pb-2 font-semibold tracking-wide">{t("topEmployers")}</th>
                    <th className="text-left pb-2 font-semibold tracking-wide">{t("signal")}</th>
                    <th className="text-right pb-2 font-semibold tracking-wide">{t("score")}</th>
                    <th className="text-right pb-2 font-semibold tracking-wide">{t("vacancy")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(stats?.topEmployers ?? []).map((emp) => (
                    <Fragment key={emp.id}>
                      <tr
                        className="cursor-pointer hover:bg-card-2"
                        onClick={() => setExpandedScore(expandedScore === emp.id ? null : emp.id)}
                      >
                        <td className="py-2.5">
                          <div className="font-medium text-ink">{emp.name}</div>
                          <div className="text-xs text-ink-3">{emp.city}, {emp.region}</div>
                        </td>
                        <td className="py-2.5">
                          <span className={SIGNAL_COLOR[emp.sponsorshipSignal] ?? "pill pill-gray"}>
                            {emp.sponsorshipSignal}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 sm:w-20 bg-card-2 rounded-full h-1.5 hidden sm:block">
                              <div
                                className="bg-accent h-1.5 rounded-full"
                                style={{ width: `${emp.score}%` }}
                              />
                            </div>
                            <span className="font-bold text-ink w-8 tabular">{emp.score}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right text-ink-2 tabular">{emp._count.vacancies}</td>
                      </tr>
                      {expandedScore === emp.id && emp.scoreBreakdown && (
                        <tr>
                          <td colSpan={4} className="py-2 px-2 sm:px-4 bg-card-2 text-xs">
                            <div className="grid grid-cols-5 gap-2 sm:gap-3 text-center py-2">
                              {["sponsorship", "vacancy", "channel", "behavior", "context"].map((key) => (
                                <div key={key}>
                                  <div className="text-ink-3 uppercase text-[10px]">{t(key as never)}</div>
                                  <div className="text-ink font-bold text-base sm:text-lg tabular">
                                    {(emp.scoreBreakdown as Record<string, number>)?.[key] ?? 0}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {Array.isArray((emp.scoreBreakdown as Record<string, unknown>)?.signals) && (
                              <ul className="text-ink-2 space-y-0.5 mt-1">
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

// Pipeline funnel: ingested → matched → reviewed → sent → delivered → replied →
// interview → placed. Self-contained; fetches /api/funnel.
function PipelineFunnel() {
  const t = useTranslations("funnel");
  const [stages, setStages] = useState<{ key: string; count: number }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/funnel").then((r) => r.json()).then((d) => { if (alive) setStages(d.stages ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (stages.length === 0) return null;
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="bg-card border border-line rounded-xl p-3 sm:p-4">
      <div className="text-xs font-semibold text-ink-3 mb-3">{t("title")}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {stages.map((s) => (
          <div key={s.key} className="min-w-0">
            <div className="text-[11px] text-ink-3 truncate">{t(s.key)}</div>
            <div className="text-lg font-bold text-ink tabular-nums">{s.count.toLocaleString()}</div>
            <div className="h-1.5 mt-1 rounded-full bg-card-2 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${Math.round((s.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
