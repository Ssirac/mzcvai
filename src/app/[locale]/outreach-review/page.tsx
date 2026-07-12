"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";
import { useToast } from "../_components/Toast";
import { jsonFetch } from "@/lib/clientApi";

interface Item {
  id: string;
  candidate: { name: string; beruf: string } | null;
  employer: { name: string; city: string | null; genericEmail: string | null; outreachConsent: boolean } | null;
  job: { title: string } | null;
}

export default function OutreachReviewPage() {
  const t = useTranslations("outreachReview");
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await jsonFetch("/api/outreach-review");
    setItems((data.items as Item[]) ?? []);
    setSelected(new Set());
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(ids: string[], action: "send" | "dismiss") {
    if (!ids.length) return;
    setBusy(true);
    const { ok, data } = await jsonFetch("/api/outreach-review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    setBusy(false);
    if (!ok) { toast(String(data.error ?? t("actionFailed")), "error"); return; }
    if (action === "send") toast(t("sentToast", { sent: Number(data.sent ?? 0), failed: Number(data.failed ?? 0) }), Number(data.failed ?? 0) > 0 ? "info" : "success");
    else toast(t("dismissedToast", { count: Number(data.dismissed ?? 0) }), "success");
    await load();
  }

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="outreachReview" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-sky-400 to-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-ink flex items-center gap-2">
                {t("title")}
                {!loading && items.length > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">{items.length}</span>
                )}
              </h1>
              <p className="text-xs text-ink-3">{t("subtitle", { min: 85, max: 92 })}</p>
            </div>
          </div>
          <button onClick={() => void load()} disabled={loading || busy}
            className="text-sm text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-3 py-2 disabled:opacity-50">
            {t("refresh")}
          </button>
        </div>

        {selected.size > 0 && (
          <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 bg-card border border-line-strong rounded-xl px-3 py-2 shadow-lg">
            <span className="text-sm text-ink font-medium">{t("selectedCount", { count: selected.size })}</span>
            <div className="flex-1" />
            <button onClick={() => run(selectedIds, "dismiss")} disabled={busy}
              className="text-sm font-medium bg-card-2 text-ink-3 hover:bg-line border border-line-strong rounded-lg px-3 py-1.5 disabled:opacity-50">{t("dismiss")}</button>
            <button onClick={() => run(selectedIds, "send")} disabled={busy}
              className="text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3 py-1.5 disabled:opacity-50">{t("approveSend")}</button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-ink-3 py-16 text-sm">…</div>
        ) : items.length === 0 ? (
          <div className="text-center text-ink-3 py-16 text-sm border border-dashed border-line rounded-xl">{t("empty")}</div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs text-ink-3 px-1 cursor-pointer select-none">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-600" />
              {t("selectAll")}
            </label>
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.id} className="bg-card border border-line rounded-xl p-3 flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} className="mt-1 accent-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-semibold text-ink">{it.candidate?.name ?? "—"}</span>
                      <span className="text-ink-3">·</span>
                      <span className="text-ink-2">{it.candidate?.beruf}</span>
                      <span className="text-ink-3">→</span>
                      <span className="text-ink">{it.job?.title ?? "—"}</span>
                      <span className="text-ink-3">@</span>
                      <span className="text-ink-2">{it.employer?.name}{it.employer?.city ? `, ${it.employer.city}` : ""}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                      <span className="text-ink-3">{t("to")}:</span>
                      <span className="text-ink-2 font-mono">{it.employer?.genericEmail ?? "—"}</span>
                      {!it.employer?.outreachConsent && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500">{t("noConsent")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => run([it.id], "dismiss")} disabled={busy}
                      className="text-xs font-medium bg-card-2 text-ink-3 hover:bg-line border border-line-strong rounded-lg px-2.5 py-1 disabled:opacity-50">{t("dismiss")}</button>
                    <button onClick={() => run([it.id], "send")} disabled={busy || !it.employer?.outreachConsent || !it.employer?.genericEmail}
                      className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1 disabled:opacity-50">{t("approveSend")}</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
