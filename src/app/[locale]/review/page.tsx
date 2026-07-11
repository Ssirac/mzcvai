"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";
import { useToast } from "../_components/Toast";
import { jsonFetch } from "@/lib/clientApi";

interface ReviewItem {
  id: string;
  subject: string | null;
  draftBody: string;
  toAddress: string | null;
  status: string; // DRAFT | APPROVED
  createdAt: string;
  match: {
    candidate: { name: string; beruf: string } | null;
    employer: { name: string; city: string | null; genericEmail: string | null; sponsorshipSignal: string } | null;
    vacancy: { title: string; region: string } | null;
  };
}

type BatchAction = "approve" | "send" | "approve-and-send";

export default function ReviewPage() {
  const t = useTranslations("review");
  const toast = useToast();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [draftRes, apprRes] = await Promise.all([
      jsonFetch("/api/outreach?status=DRAFT"),
      jsonFetch("/api/outreach?status=APPROVED"),
    ]);
    const merged = [
      ...((draftRes.data.outreaches as ReviewItem[]) ?? []),
      ...((apprRes.data.outreaches as ReviewItem[]) ?? []),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setItems(merged);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function prepare() {
    setPreparing(true);
    const { data } = await jsonFetch("/api/outreach/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 25 }),
    });
    setPreparing(false);
    const prepared = Number(data.prepared ?? 0);
    toast(prepared > 0 ? t("preparedToast", { count: prepared }) : t("nothingPrepared"), prepared > 0 ? "success" : "info");
    if (prepared > 0) await load();
  }

  async function runBatch(ids: string[], action: BatchAction) {
    if (ids.length === 0) return;
    setBusy(true);
    const { ok, data } = await jsonFetch("/api/outreach/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    setBusy(false);
    if (!ok) { toast(String(data.error ?? t("actionFailed")), "error"); return; }
    if (action === "approve") {
      toast(t("approvedToast", { approved: Number(data.approved ?? 0) }), "success");
    } else {
      const failed = Number(data.failed ?? 0);
      toast(t("sentToast", { sent: Number(data.sent ?? 0), failed }), failed > 0 ? "info" : "success");
    }
    await load();
  }

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleExpand = (id: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="review" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-green-400 to-emerald-600" />
            <div>
              <h1 className="text-xl font-bold text-ink flex items-center gap-2">
                {t("title")}
                {!loading && items.length > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">{items.length}</span>
                )}
              </h1>
              <p className="text-xs text-ink-3">{t("subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={prepare}
              disabled={preparing || busy}
              className="text-sm font-medium bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30 rounded-lg px-3 py-2 disabled:opacity-50"
            >
              {preparing ? t("preparing") : t("prepare")}
            </button>
            <button
              onClick={() => void load()}
              disabled={loading || busy}
              className="text-sm text-ink-2 hover:text-ink bg-card-2 hover:bg-line border border-line-strong rounded-lg px-3 py-2 disabled:opacity-50"
            >
              {t("refresh")}
            </button>
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 bg-card border border-line-strong rounded-xl px-3 py-2 shadow-lg">
            <span className="text-sm text-ink font-medium">{t("selectedCount", { count: selected.size })}</span>
            <div className="flex-1" />
            <button
              onClick={() => runBatch(selectedIds, "approve")}
              disabled={busy}
              className="text-sm font-medium bg-card-2 text-ink hover:bg-line border border-line-strong rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              {t("approve")}
            </button>
            <button
              onClick={() => runBatch(selectedIds, "approve-and-send")}
              disabled={busy}
              className="text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? t("working") : t("approveSend")}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm text-ink-3 hover:text-ink px-2 py-1.5"
            >
              {t("clear")}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-ink-3 py-16 text-sm">…</div>
        ) : items.length === 0 ? (
          <div className="text-center text-ink-3 py-16 text-sm border border-dashed border-line rounded-xl">
            {t("empty")}
          </div>
        ) : (
          <>
            {/* Select-all row */}
            <label className="flex items-center gap-2 text-xs text-ink-3 px-1 cursor-pointer select-none">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-600" />
              {t("selectAll")}
            </label>

            <div className="space-y-2">
              {items.map((it) => {
                const isOpen = expanded.has(it.id);
                const isDraft = it.status === "DRAFT";
                return (
                  <div key={it.id} className="bg-card border border-line rounded-xl overflow-hidden">
                    <div className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggle(it.id)}
                        className="mt-1 accent-emerald-600"
                      />
                      <div className="min-w-0 flex-1">
                        {/* candidate → job → employer */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-semibold text-ink">{it.match.candidate?.name ?? "—"}</span>
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-2">{it.match.candidate?.beruf}</span>
                          <span className="text-ink-3">→</span>
                          <span className="text-ink">{it.match.vacancy?.title ?? "—"}</span>
                          <span className="text-ink-3">@</span>
                          <span className="text-ink-2">
                            {it.match.employer?.name}
                            {it.match.employer?.city ? `, ${it.match.employer.city}` : ""}
                          </span>
                        </div>
                        {/* to address + status */}
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                          <span className={`px-1.5 py-0.5 rounded font-medium ${isDraft ? "bg-amber-500/15 text-amber-500" : "bg-emerald-600/15 text-emerald-500"}`}>
                            {isDraft ? t("draft") : t("approved")}
                          </span>
                          <span className="text-ink-3">{t("to")}:</span>
                          {it.toAddress ? (
                            <span className="text-ink-2 font-mono">{it.toAddress}</span>
                          ) : (
                            <span className="text-rose-500">{t("noEmail")}</span>
                          )}
                          <button onClick={() => toggleExpand(it.id)} className="ml-auto text-accent hover:underline">
                            {it.subject ?? "—"}
                          </button>
                        </div>
                      </div>
                      {/* row actions */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {isDraft && (
                          <button
                            onClick={() => runBatch([it.id], "approve")}
                            disabled={busy}
                            className="text-xs font-medium bg-card-2 text-ink hover:bg-line border border-line-strong rounded-lg px-2.5 py-1 disabled:opacity-50"
                          >
                            {t("approve")}
                          </button>
                        )}
                        <button
                          onClick={() => runBatch([it.id], "approve-and-send")}
                          disabled={busy || !it.toAddress}
                          className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1 disabled:opacity-50"
                        >
                          {t("send")}
                        </button>
                      </div>
                    </div>
                    {/* email preview */}
                    {isOpen && (
                      <div className="border-t border-line bg-card-2 px-3 py-3">
                        <div className="text-xs text-ink-3 mb-1 font-medium">{it.subject}</div>
                        <pre className="text-xs text-ink-2 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-auto">{it.draftBody}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
