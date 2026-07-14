"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";
import { jsonFetch } from "@/lib/clientApi";

interface Audit { id: string; actor: string; action: string; targetType: string | null; targetId: string | null; createdAt: string }
interface Cron { id: string; job: string; status: string; startedAt: string; durationMs: number | null; error: string | null; result: Record<string, unknown> | null }
interface Health { status: string; db: string; mailProvider: string; sending: { paused: boolean; reason: string | null; rate: number } | null }
interface Campaign { campaign: string; templateVersion: string; sent: number; delivered: number; opened: number; replied: number; bounced: number; replyRate: number; bounceRate: number }
interface ReconcileMove { employer: string | null; from: string; to: string; via: string; subject: string }
interface Reconcile { applied: boolean; scanned: number; reassigned: number; conflicts: number; unmatched: number; moves: ReconcileMove[] }

const CRON_STYLE: Record<string, string> = {
  completed: "bg-emerald-600/15 text-emerald-500",
  running: "bg-sky-500/15 text-sky-500",
  failed: "bg-rose-500/15 text-rose-500",
  skipped_locked: "bg-card-2 text-ink-3",
};

function fmt(d: string) { return new Date(d).toLocaleString(); }

// Compact, human-readable summary of a cron run's stored result. For the dead
// sweep it shows how many listings were checked / deleted / expired so a
// reviewer can see what a cleanup actually did.
function cronResult(result: Record<string, unknown> | null): string {
  if (!result || typeof result !== "object") return "—";
  const r = result as Record<string, unknown>;
  const parts: string[] = [];
  if ("checked" in r) parts.push(`${Number(r.checked ?? 0)} yoxlanıldı`);
  if ("deleted" in r) parts.push(`${Number(r.deleted ?? 0)} silindi`);
  if ("expired" in r) parts.push(`${Number(r.expired ?? 0)} arxivləndi`);
  if (parts.length) return parts.join(" · ");
  const entries = Object.entries(r).filter(([, v]) => typeof v === "number" && (v as number) > 0);
  return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(" · ") : "—";
}

export default function SystemPage() {
  const t = useTranslations("system");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [cron, setCron] = useState<Cron[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [recon, setRecon] = useState<Reconcile | null>(null);
  const [reconBusy, setReconBusy] = useState(false);

  const runReconcile = useCallback(async (apply: boolean) => {
    if (apply && !window.confirm("Səhv bağlanmış cavablar düzgün namizədə köçürüləcək. Davam edilsin?")) return;
    setReconBusy(true);
    try {
      const r = await jsonFetch("/api/replies/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply }) });
      setRecon(r.data as unknown as Reconcile);
    } finally {
      setReconBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, c, h, cm] = await Promise.all([
      jsonFetch("/api/audit?limit=100"),
      jsonFetch("/api/cron-runs?limit=50"),
      jsonFetch("/api/health"),
      jsonFetch("/api/campaigns"),
    ]);
    setAudit((a.data.items as Audit[]) ?? []);
    setCron((c.data.items as Cron[]) ?? []);
    setHealth(h.data as unknown as Health);
    setCampaigns((cm.data.campaigns as Campaign[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="system" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-slate-400 to-slate-600" />
            <div>
              <h1 className="text-xl font-bold text-ink">{t("title")}</h1>
              <p className="text-xs text-ink-3">{t("subtitle")}</p>
            </div>
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="text-sm text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-3 py-2 disabled:opacity-50">{t("refresh")}</button>
        </div>

        {/* Health tiles */}
        {health && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label={t("status")} value={health.status} ok={health.status === "ok"} />
            <Tile label="DB" value={health.db} ok={health.db === "up"} />
            <Tile label={t("mail")} value={health.mailProvider} ok={health.mailProvider !== "none"} />
            <Tile label={t("sending")} value={health.sending?.paused ? t("paused") : t("active")} ok={!health.sending?.paused} />
          </div>
        )}

        {/* Campaigns */}
        {campaigns.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-ink">{t("campaigns")}</h2>
            <div className="overflow-x-auto border border-line rounded-xl">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-left text-ink-3 text-xs border-b border-line">
                  <th className="px-3 py-2 font-medium">{t("campaign")}</th><th className="px-3 py-2 font-medium">{t("template")}</th>
                  <th className="px-3 py-2 font-medium">{t("sent")}</th><th className="px-3 py-2 font-medium">{t("replied")}</th>
                  <th className="px-3 py-2 font-medium">{t("replyRate")}</th><th className="px-3 py-2 font-medium">{t("bounceRate")}</th>
                </tr></thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="px-3 py-2 text-ink">{c.campaign}</td>
                      <td className="px-3 py-2 text-ink-3">{c.templateVersion}</td>
                      <td className="px-3 py-2 text-ink-2 tabular-nums">{c.sent}</td>
                      <td className="px-3 py-2 text-ink-2 tabular-nums">{c.replied}</td>
                      <td className="px-3 py-2 text-emerald-500 tabular-nums">{(c.replyRate * 100).toFixed(1)}%</td>
                      <td className={`px-3 py-2 tabular-nums ${c.bounceRate > 0.1 ? "text-rose-500" : "text-ink-3"}`}>{(c.bounceRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Reply reconciliation (one-off repair) */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">Cavabları yenidən uyğunlaşdır</h2>
              <p className="text-xs text-ink-3">Səhv namizədə bağlanmış köhnə cavabları düzgün namizədə köçürür.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void runReconcile(false)} disabled={reconBusy}
                className="text-sm text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-3 py-2 disabled:opacity-50">Yoxla</button>
              <button onClick={() => void runReconcile(true)} disabled={reconBusy || !recon || recon.reassigned === 0}
                className="text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-2 disabled:opacity-50">Düzəlt</button>
            </div>
          </div>
          {recon && (
            <div className="border border-line rounded-xl p-3 space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-card-2 text-ink-2">Yoxlanan: {recon.scanned}</span>
                <span className="px-2 py-1 rounded bg-emerald-600/15 text-emerald-500">{recon.applied ? "Köçürüldü" : "Köçürüləcək"}: {recon.reassigned}</span>
                <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-500">Konflikt: {recon.conflicts}</span>
                <span className="px-2 py-1 rounded bg-card-2 text-ink-3">Tapılmadı: {recon.unmatched}</span>
              </div>
              {recon.moves.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead><tr className="text-left text-ink-3 text-xs border-b border-line">
                      <th className="px-3 py-2 font-medium">Şirkət</th><th className="px-3 py-2 font-medium">Səhv namizəd</th>
                      <th className="px-3 py-2 font-medium">Düzgün namizəd</th><th className="px-3 py-2 font-medium">Üsul</th>
                    </tr></thead>
                    <tbody>
                      {recon.moves.map((m, i) => (
                        <tr key={i} className="border-b border-line/60">
                          <td className="px-3 py-2 text-ink-3">{m.employer ?? "—"}</td>
                          <td className="px-3 py-2 text-rose-500">{m.from}</td>
                          <td className="px-3 py-2 text-emerald-500">{m.to}</td>
                          <td className="px-3 py-2 text-ink-3">{m.via === "code" ? "kod" : "ad"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {recon.applied && <p className="text-xs text-emerald-500">Tamamlandı — cavablar düzgün namizədlərə bağlandı.</p>}
              {!recon.applied && recon.reassigned > 0 && <p className="text-xs text-ink-3">Yuxarıdakı köçürmələri təsdiqləmək üçün “Düzəlt” düyməsinə basın.</p>}
              {!recon.applied && recon.reassigned === 0 && <p className="text-xs text-ink-3">Düzəldiləsi cavab tapılmadı.</p>}
            </div>
          )}
        </section>

        {/* Cron runs */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">{t("cronRuns")}</h2>
          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-ink-3 text-xs border-b border-line">
                <th className="px-3 py-2 font-medium">{t("job")}</th><th className="px-3 py-2 font-medium">{t("cronStatus")}</th>
                <th className="px-3 py-2 font-medium">Nəticə</th>
                <th className="px-3 py-2 font-medium">{t("duration")}</th><th className="px-3 py-2 font-medium">{t("started")}</th>
              </tr></thead>
              <tbody>
                {cron.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="px-3 py-2 text-ink">{r.job}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs ${CRON_STYLE[r.status] ?? "bg-card-2 text-ink-2"}`}>{r.status}</span>{r.error && <span className="ml-2 text-rose-500 text-xs">{r.error.slice(0, 40)}</span>}</td>
                    <td className="px-3 py-2 text-ink-3 text-xs">{cronResult(r.result)}</td>
                    <td className="px-3 py-2 text-ink-3">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="px-3 py-2 text-ink-3">{fmt(r.startedAt)}</td>
                  </tr>
                ))}
                {cron.length === 0 && !loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-3 text-sm">{t("empty")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* Audit log */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">{t("auditLog")}</h2>
          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-ink-3 text-xs border-b border-line">
                <th className="px-3 py-2 font-medium">{t("when")}</th><th className="px-3 py-2 font-medium">{t("actor")}</th>
                <th className="px-3 py-2 font-medium">{t("action")}</th><th className="px-3 py-2 font-medium">{t("target")}</th>
              </tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-b border-line/60">
                    <td className="px-3 py-2 text-ink-3">{fmt(a.createdAt)}</td>
                    <td className="px-3 py-2 text-ink">{a.actor}</td>
                    <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-xs bg-accent/15 text-accent">{a.action}</span></td>
                    <td className="px-3 py-2 text-ink-3">{a.targetType ? `${a.targetType}:${(a.targetId ?? "").slice(0, 8)}` : "—"}</td>
                  </tr>
                ))}
                {audit.length === 0 && !loading && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-3 text-sm">{t("empty")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="bg-card border border-line rounded-xl p-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`text-sm font-semibold mt-1 ${ok ? "text-emerald-500" : "text-rose-500"}`}>{value}</div>
    </div>
  );
}
