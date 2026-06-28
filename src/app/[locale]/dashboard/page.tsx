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

  useEffect(() => {
    fetchStats();
    fetchOutreaches();
    fetchSources();
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
        <div>
          <h1 className="text-lg font-bold text-white">{t("title")}</h1>
          <p className="text-sm text-gray-500">{t("subtitle")}</p>
        </div>


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
