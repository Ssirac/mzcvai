"use client";

import { useEffect, useState } from "react";
import TopNav from "../_components/TopNav";

interface Row { key: string; name?: string; sent: number; replied: number; opened: number; replyRate: number }
interface Analytics {
  funnel: {
    sent: number; delivered: number; opened: number; replied: number; bounced: number; followUps: number;
    deliveryRate: number; openRate: number; replyRate: number; bounceRate: number;
  };
  pipeline: { interviews: number; placed: number };
  last30: { sent: number; replied: number; replyRate: number };
  byBeruf: Row[];
  byRegion: Row[];
  byCandidate: Row[];
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="card card-lift p-4">
      <div className="eyebrow mb-1">{label}</div>
      <div className={`tabular text-2xl font-bold ${color ?? "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

function Bar({ rate, cls = "bg-accent" }: { rate: number; cls?: string }) {
  return (
    <div className="h-1.5 bg-card-2 rounded-full overflow-hidden w-full">
      <div className={`h-full ${cls} rounded-full`} style={{ width: `${Math.min(rate, 100)}%`, transition: "width 500ms ease" }} />
    </div>
  );
}

function Table({ title, rows, labelKey }: { title: string; rows: Row[]; labelKey: "name" | "key" }) {
  return (
    <div className="card p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-ink-2 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-ink-3 text-xs py-4 text-center">Hələ məlumat yoxdur.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
              <div className="min-w-0">
                <div className="text-sm text-ink truncate">{labelKey === "name" ? r.name : r.key}</div>
                <Bar rate={r.replyRate} />
              </div>
              <div className="text-right text-xs whitespace-nowrap">
                <span className="tabular text-accent font-semibold">{r.replyRate}%</span>
                <span className="tabular text-ink-3"> · {r.replied}/{r.sent}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/analytics");
        setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const f = data?.funnel;
  const funnelStages = f
    ? [
        { label: "Göndərildi", value: f.sent, cls: "bg-line-strong" },
        { label: "Çatdı", value: f.delivered, cls: "bg-blue-500" },
        { label: "Açıldı", value: f.opened, cls: "bg-violet-500" },
        { label: "Cavab", value: f.replied, cls: "bg-accent", star: true },
      ]
    : [];

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="analytics" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        <div className="flex items-center gap-3">
          <span className="w-1 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-teal-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">Analitika</h1>
            <p className="text-sm text-ink-3">Müraciət hunisi və cavab faizi</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-5">
            <div className="skeleton h-40 rounded-2xl" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}
            </div>
          </div>
        ) : !f || f.sent === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-ink font-semibold mb-1">Hələ statistika yoxdur</div>
            <div className="text-ink-3 text-sm max-w-sm mx-auto">Müraciətlər göndərildikcə cavab faizi, huni və bölgülər burada avtomatik görünəcək.</div>
          </div>
        ) : (
          <>
            {/* Hero — reply rate + funnel (mirrors the dashboard signature) */}
            <div className="card card-lift p-5 sm:p-6 grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr] lg:items-center">
              <div>
                <div className="eyebrow mb-2">Cavab faizi</div>
                <div className="flex items-end gap-1">
                  <span className="tabular text-5xl sm:text-6xl font-bold text-accent leading-none">{f.replyRate}</span>
                  <span className="tabular text-2xl sm:text-3xl text-ink-3 font-semibold leading-none pb-1">%</span>
                </div>
                <p className="text-sm text-ink-2 mt-3 leading-relaxed">
                  Ümumilikdə <b className="text-ink tabular">{f.replied}</b> cavab / <b className="text-ink tabular">{f.sent}</b> göndərişdən.
                </p>
                {data && data.last30.sent > 0 && (
                  <p className="text-xs text-ink-3 mt-1.5">
                    Son 30 gün: <span className="tabular text-ink-2">{data.last30.replyRate}%</span> ({data.last30.replied}/{data.last30.sent})
                  </p>
                )}
              </div>
              <div className="space-y-2.5">
                {funnelStages.map((s, i) => {
                  const base = f.sent || 0;
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

            {/* Secondary funnel metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Çatdırıldı" value={`${f.deliveryRate}%`} sub={`${f.delivered} mail`} color="text-blue-400" />
              <Stat label="Açılma" value={`${f.openRate}%`} sub={`${f.opened} mail`} color="text-violet-400" />
              <Stat label="Çatmadı" value={`${f.bounceRate}%`} sub={`${f.bounced} bounce`} color="text-red-400" />
              <Stat label="Follow-up" value={f.followUps} sub="göndərildi" color="text-blue-400" />
            </div>

            {/* Placement pipeline */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Müsahibə" value={data?.pipeline?.interviews ?? 0} color="text-violet-400" sub="aktiv mərhələ" />
              <Stat label="İşə düzəldi" value={data?.pipeline?.placed ?? 0} color="text-emerald-400" sub="yerləşdirmə" />
              <Stat label="Son 30 gün — cavab faizi" value={`${data?.last30.replyRate ?? 0}%`} sub={`${data?.last30.replied ?? 0}/${data?.last30.sent ?? 0}`} color="text-green-400" />
            </div>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Table title="Peşə üzrə cavab faizi" rows={data?.byBeruf ?? []} labelKey="key" />
              <Table title="Region üzrə cavab faizi" rows={data?.byRegion ?? []} labelKey="key" />
              <Table title="Namizəd üzrə cavab faizi" rows={data?.byCandidate ?? []} labelKey="name" />
            </div>

            <p className="text-xs text-ink-3">
              Cavab faizi = cavab verən işəgötürənlər / göndərilən müraciətlər. Açılma izləmə Resend tracking subdomain aktivləşəndən sonra dəqiqləşir.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
