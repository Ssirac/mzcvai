"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";
import { jsonFetch } from "@/lib/clientApi";

interface Audit { id: string; actor: string; action: string; targetType: string | null; targetId: string | null; createdAt: string }
interface Cron { id: string; job: string; status: string; startedAt: string; durationMs: number | null; error: string | null }
interface Health { status: string; db: string; mailProvider: string; sending: { paused: boolean; reason: string | null; rate: number } | null }

const CRON_STYLE: Record<string, string> = {
  completed: "bg-emerald-600/15 text-emerald-500",
  running: "bg-sky-500/15 text-sky-500",
  failed: "bg-rose-500/15 text-rose-500",
  skipped_locked: "bg-card-2 text-ink-3",
};

function fmt(d: string) { return new Date(d).toLocaleString(); }

export default function SystemPage() {
  const t = useTranslations("system");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [cron, setCron] = useState<Cron[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, c, h] = await Promise.all([
      jsonFetch("/api/audit?limit=100"),
      jsonFetch("/api/cron-runs?limit=50"),
      jsonFetch("/api/health"),
    ]);
    setAudit((a.data.items as Audit[]) ?? []);
    setCron((c.data.items as Cron[]) ?? []);
    setHealth(h.data as unknown as Health);
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

        {/* Cron runs */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">{t("cronRuns")}</h2>
          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-ink-3 text-xs border-b border-line">
                <th className="px-3 py-2 font-medium">{t("job")}</th><th className="px-3 py-2 font-medium">{t("cronStatus")}</th>
                <th className="px-3 py-2 font-medium">{t("duration")}</th><th className="px-3 py-2 font-medium">{t("started")}</th>
              </tr></thead>
              <tbody>
                {cron.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="px-3 py-2 text-ink">{r.job}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs ${CRON_STYLE[r.status] ?? "bg-card-2 text-ink-2"}`}>{r.status}</span>{r.error && <span className="ml-2 text-rose-500 text-xs">{r.error.slice(0, 40)}</span>}</td>
                    <td className="px-3 py-2 text-ink-3">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="px-3 py-2 text-ink-3">{fmt(r.startedAt)}</td>
                  </tr>
                ))}
                {cron.length === 0 && !loading && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-3 text-sm">{t("empty")}</td></tr>}
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
