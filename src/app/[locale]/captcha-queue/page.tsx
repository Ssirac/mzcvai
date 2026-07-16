"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";
import { useToast } from "../_components/Toast";
import { jsonFetch } from "@/lib/clientApi";

interface QItem {
  id: string;
  jobId: string;
  candidateId: string;
  platform: string;
  jobTitle: string;
  company: string;
  applicationUrl: string;
  matchScore: number;
  blockedReason: string;
  prefilledData: Record<string, string | null> | null;
  status: string;
}
interface Group {
  candidateId: string;
  candidateName: string;
  beruf: string;
  items: QItem[];
}

// Append the candidate id to the job URL's hash so the MZ Autofill extension can
// auto-fill for the right candidate when the page opens (the extension only acts
// on it when the referrer is the MZ app, so it's safe to put in the URL).
function withFillHash(url: string, candidateId: string): string {
  const sep = url.includes("#") ? "&" : "#";
  return `${url}${sep}mzfill=${encodeURIComponent(candidateId)}`;
}

export default function CaptchaQueuePage() {
  const t = useTranslations("captchaQueue");
  const toast = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "ready" | "verify">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await jsonFetch("/api/captcha-queue");
    setGroups((data.groups as Group[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function setStatus(id: string, status: string) {
    const { ok, data } = await jsonFetch(`/api/captcha-queue/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!ok) { toast(String(data.error ?? t("actionFailed")), "error"); return; }
    toast(t("statusUpdated"), "success");
    await load();
  }

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast(t("copied"), "success")).catch(() => {});
  };
  const copyAll = (d: Record<string, string | null> | null) => {
    if (!d) return;
    copy(Object.entries(d).map(([k, v]) => `${k}: ${v ?? ""}`).join("\n"));
  };

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  // "ready" = a plain form the extension can fill and the human just submits;
  // "verify" = a captcha/OTP that needs a human check first. Doing the ready ones
  // in a batch is much faster, so let the user focus on them.
  const isReady = (reason: string) => /form/i.test(reason);
  // 🔑 the job needs an account/login before the form is reachable — either the
  // scanner saw a password wall, or the apply link goes to the arbeitsagentur
  // portal (its applications always sit behind a Bundesagentur account).
  const needsLogin = (it: { blockedReason: string; applicationUrl: string }) => {
    if (/login/i.test(it.blockedReason)) return true;
    try { return /(^|\.)arbeitsagentur\.de$/i.test(new URL(it.applicationUrl).hostname); } catch { return false; }
  };
  const readyCount = groups.reduce((n, g) => n + g.items.filter((i) => isReady(i.blockedReason)).length, 0);
  const verifyCount = total - readyCount;
  const match = (reason: string) => view === "all" || (view === "ready" ? isReady(reason) : !isReady(reason));
  const shownGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => match(it.blockedReason)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="captcha" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-amber-400 to-orange-600" />
            <div>
              <h1 className="text-xl font-bold text-ink flex items-center gap-2">
                {t("title")}
                {!loading && total > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">{total}</span>
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

        {!loading && total > 0 && (
          <div className="flex flex-wrap gap-2">
            {([
              ["all", `Hamısı ${total}`],
              ["ready", `✅ Hazır (form) ${readyCount}`],
              ["verify", `🔒 Captcha/OTP ${verifyCount}`],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => setView(key)}
                className={`text-xs font-medium rounded-full px-3 py-1.5 border ${view === key ? "bg-accent/15 text-accent border-accent/40" : "bg-card-2 text-ink-2 border-line hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center text-ink-3 py-16 text-sm">…</div>
        ) : total === 0 ? (
          <div className="text-center text-ink-3 py-16 text-sm border border-dashed border-line rounded-xl">{t("empty")}</div>
        ) : shownGroups.length === 0 ? (
          <div className="text-center text-ink-3 py-16 text-sm border border-dashed border-line rounded-xl">Bu filtrdə iş yoxdur.</div>
        ) : (
          <div className="space-y-5">
            {shownGroups.map((g) => (
              <div key={g.candidateId} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="font-semibold text-ink">{g.candidateName}</span>
                  {g.beruf && <span className="text-xs text-ink-3">· {g.beruf}</span>}
                  <span className="text-xs text-amber-500">— {t("jobsWaiting", { count: g.items.length })}</span>
                </div>
                {g.items.map((it) => {
                  const panelOpen = openPanel === it.id;
                  return (
                    <div key={it.id} className="bg-card border border-line rounded-xl overflow-hidden">
                      <div className="flex flex-wrap items-center gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink font-medium truncate">{it.jobTitle}</div>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                            <span className="text-ink-2">{it.company}</span>
                            <span className="px-1.5 py-0.5 rounded bg-card-2 text-ink-2 border border-line">{it.platform}</span>
                            <span className="text-ink-3">{t("matchScore")}: {Math.round(it.matchScore)}</span>
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500">{t("blocked")}: {it.blockedReason}</span>
                            {needsLogin(it) && (
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-500 font-medium">🔑 {t("loginNeeded")}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a href={withFillHash(it.applicationUrl, it.candidateId)} target="_blank" rel="noopener"
                            className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1.5">
                            {t("open")}
                          </a>
                          <button onClick={() => setOpenPanel(panelOpen ? null : it.id)}
                            className="text-xs font-medium bg-card-2 text-ink hover:bg-line border border-line-strong rounded-lg px-2.5 py-1.5">
                            {t("fillData")}
                          </button>
                          <button onClick={() => setStatus(it.id, "SUBMITTED")}
                            className="text-xs font-medium bg-card-2 text-emerald-500 hover:bg-line border border-line-strong rounded-lg px-2.5 py-1.5">
                            {t("markSubmitted")}
                          </button>
                          <button onClick={() => setStatus(it.id, "SKIPPED")}
                            className="text-xs font-medium bg-card-2 text-ink-3 hover:bg-line border border-line-strong rounded-lg px-2.5 py-1.5">
                            {t("markSkipped")}
                          </button>
                        </div>
                      </div>
                      {panelOpen && it.prefilledData && (
                        <div className="border-t border-line bg-card-2 px-3 py-3 space-y-1.5">
                          <div className="flex justify-end">
                            <button onClick={() => copyAll(it.prefilledData)}
                              className="text-xs font-medium text-accent hover:underline">{t("copyAll")}</button>
                          </div>
                          {Object.entries(it.prefilledData).map(([k, v]) => (
                            <div key={k} className="flex items-center gap-2 text-xs">
                              <span className="text-ink-3 w-28 shrink-0">{k}</span>
                              <span className="text-ink-2 font-mono flex-1 truncate">{v ?? "—"}</span>
                              {v && (
                                <button onClick={() => copy(v)} aria-label="copy"
                                  className="text-accent hover:underline shrink-0">⧉</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
