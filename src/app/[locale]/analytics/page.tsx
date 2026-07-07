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
    <div className="bg-card border border-line rounded-2xl p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

function Bar({ rate }: { rate: number }) {
  return (
    <div className="h-1.5 bg-card-2 rounded-full overflow-hidden w-full">
      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(rate, 100)}%` }} />
    </div>
  );
}

function Table({ title, rows, labelKey }: { title: string; rows: Row[]; labelKey: "name" | "key" }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-card border border-line rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">{title}</h3>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
            <div className="min-w-0">
              <div className="text-sm text-ink truncate">{labelKey === "name" ? r.name : r.key}</div>
              <Bar rate={r.replyRate} />
            </div>
            <div className="text-right text-xs whitespace-nowrap">
              <span className="text-green-400 font-semibold">{r.replyRate}%</span>
              <span className="text-ink-3"> · {r.replied}/{r.sent}</span>
            </div>
          </div>
        ))}
      </div>
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

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="analytics" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        <h1 className="text-xl font-bold text-ink">Analitika</h1>

        {loading ? (
          <div className="text-ink-3 text-sm">Yüklənir...</div>
        ) : !data?.funnel || data.funnel.sent === 0 ? (
          <div className="text-ink-3 text-sm bg-card border border-line rounded-2xl p-6">
            Hələ göndərilmiş müraciət yoxdur. Müraciət göndərdikcə statistika burada görünəcək.
          </div>
        ) : (
          <>
            {/* Funnel */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="Göndərildi" value={data.funnel.sent} />
              <Stat label="Çatdırıldı" value={`${data.funnel.deliveryRate}%`} sub={`${data.funnel.delivered} mail`} color="text-emerald-300" />
              <Stat label="Açıldı" value={`${data.funnel.openRate}%`} sub={`${data.funnel.opened} mail`} color="text-violet-300" />
              <Stat label="Cavab verdi" value={`${data.funnel.replyRate}%`} sub={`${data.funnel.replied} cavab`} color="text-green-300" />
              <Stat label="Çatmadı" value={`${data.funnel.bounceRate}%`} sub={`${data.funnel.bounced} bounce`} color="text-red-300" />
              <Stat label="Follow-up" value={data.funnel.followUps} sub="göndərildi" color="text-blue-300" />
            </div>

            {/* Placement pipeline */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Müsahibə" value={data.pipeline?.interviews ?? 0} color="text-violet-300" sub="aktiv mərhələ" />
              <Stat label="İşə düzəldi" value={data.pipeline?.placed ?? 0} color="text-emerald-300" sub="yerləşdirmə" />
              <Stat label="Son 30 gün — cavab faizi" value={`${data.last30.replyRate}%`} sub={`${data.last30.replied}/${data.last30.sent}`} color="text-green-300" />
            </div>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Table title="Peşə üzrə cavab faizi" rows={data.byBeruf} labelKey="key" />
              <Table title="Region üzrə cavab faizi" rows={data.byRegion} labelKey="key" />
              <Table title="Namizəd üzrə cavab faizi" rows={data.byCandidate} labelKey="name" />
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
