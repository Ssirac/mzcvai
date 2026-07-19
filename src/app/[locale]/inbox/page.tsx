"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import TopNav from "../_components/TopNav";

interface OutboundReply {
  id: string;
  subject: string;
  body: string;
  toAddress: string;
  attachments: { filename: string; size: number }[] | null;
  createdAt: string;
}
interface Reply {
  id: string;
  repliedAt: string | null;
  replyFrom: string | null;
  replySubject: string | null;
  replyText: string | null;
  replyCategory: string | null;
  toAddress: string | null;
  outboundReplies: OutboundReply[];
  match: {
    candidate: { id: string; name: string };
    employer: { id: string; name: string; optedOut: boolean };
    vacancy: { title: string; url: string | null };
  };
}

interface UnmatchedReply {
  from: string;
  fromName: string;
  subject: string;
  date: string;
  snippet: string;
  domain: string;
  category: string | null;
  candidates: { id: string; name: string }[];
}

// AI reply categories — display order, emoji and badge colours. Labels are a
// local trilingual map (same convention as the candidates page reason labels).
const CATEGORIES = ["INTERESTED", "INTERVIEW", "QUESTION", "REJECTED", "AUTO_REPLY", "OPT_OUT", "OTHER"] as const;
const CAT_STYLE: Record<string, { icon: string; cls: string }> = {
  INTERESTED: { icon: "🟢", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  INTERVIEW:  { icon: "📅", cls: "bg-sky-500/15 text-sky-400 border-sky-500/25" },
  QUESTION:   { icon: "❓", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  REJECTED:   { icon: "🔴", cls: "bg-rose-500/15 text-rose-400 border-rose-500/25" },
  AUTO_REPLY: { icon: "🤖", cls: "bg-card-2 text-ink-3 border-line" },
  OPT_OUT:    { icon: "🚫", cls: "bg-rose-500/10 text-rose-300 border-rose-500/20" },
  OTHER:      { icon: "⚪", cls: "bg-card-2 text-ink-3 border-line" },
};
const CAT_LABELS: Record<string, Record<string, string>> = {
  az: { INTERESTED: "Maraqlanır", INTERVIEW: "Müsahibə", QUESTION: "Sual verir", REJECTED: "Rədd", AUTO_REPLY: "Avtomatik", OPT_OUT: "Yazmayın", OTHER: "Digər" },
  de: { INTERESTED: "Interessiert", INTERVIEW: "Interview", QUESTION: "Rückfrage", REJECTED: "Absage", AUTO_REPLY: "Automatisch", OPT_OUT: "Abgemeldet", OTHER: "Sonstiges" },
  en: { INTERESTED: "Interested", INTERVIEW: "Interview", QUESTION: "Question", REJECTED: "Rejected", AUTO_REPLY: "Auto-reply", OPT_OUT: "Opt-out", OTHER: "Other" },
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

// Reply straight from the app (no IONOS webmail), with the candidate's CV in one
// click and optional file attachments.
function ReplyComposer({ outreachId, candidateName, onSent }: { outreachId: string; candidateName: string; onSent: (r: OutboundReply) => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachCv, setAttachCv] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("text", text);
      if (attachCv) fd.append("attachCv", "true");
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/inbox/${outreachId}/reply`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(String(data.error ?? "Göndərilmədi")); return; }
      onSent(data.reply as OutboundReply);
      setText(""); setFiles([]); setAttachCv(false);
    } catch {
      setErr("Şəbəkə xətası");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 border border-line rounded-xl p-3 bg-card-2/40 space-y-2">
      <div className="text-xs font-medium text-ink-2">↩ Cavab yaz</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Cavabınızı yazın…"
        className="w-full bg-surface border border-line focus:border-emerald-600/50 focus:outline-none text-ink rounded-lg px-3 py-2 text-sm placeholder:text-ink-3 resize-y"
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-card border border-line rounded px-2 py-1 text-ink-2">
              📎 {f.name}
              <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="text-ink-3 hover:text-red-400" aria-label="remove">✕</button>
            </span>
          ))}
        </div>
      )}
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-2 hover:text-ink cursor-pointer bg-card border border-line rounded-lg px-3 py-2">
            📎 Fayl
            <input type="file" multiple className="hidden"
              onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          <label className={`text-xs cursor-pointer rounded-lg px-3 py-2 border ${attachCv ? "bg-emerald-600/15 text-emerald-500 border-emerald-600/40" : "bg-card text-ink-2 border-line hover:text-ink"}`}>
            <input type="checkbox" checked={attachCv} onChange={(e) => setAttachCv(e.target.checked)} className="hidden" />
            {attachCv ? "✓ " : "📎 "}CV: {candidateName}
          </label>
        </div>
        <button onClick={send} disabled={sending || !text.trim()}
          className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 disabled:opacity-50">
          {sending ? "Göndərilir…" : "Göndər"}
        </button>
      </div>
    </div>
  );
}

// Reply to an UNMATCHED mailbox message: no thread, so we send to the raw
// from-address. The likely candidate(s) are offered for a one-click CV attach.
function UnmatchedComposer({ u, locale, onSent }: { u: UnmatchedReply; locale: string; onSent: () => void }) {
  const [text, setText] = useState("");
  const [subject, setSubject] = useState(/^(aw|re)\s*:/i.test(u.subject) ? u.subject : `AW: ${u.subject || "Bewerbung"}`);
  const [cvFor, setCvFor] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("to", u.from);
      fd.append("subject", subject);
      fd.append("text", text);
      if (cvFor) fd.append("candidateId", cvFor);
      const res = await fetch("/api/inbox/unmatched-reply", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(String(data.error ?? "Göndərilmədi")); return; }
      setDone(true); setText(""); onSent();
    } catch { setErr("Şəbəkə xətası"); } finally { setSending(false); }
  }

  if (done) return <div className="mt-2 text-xs text-emerald-400">✓ {locale === "de" ? "Gesendet" : locale === "en" ? "Sent" : "Göndərildi"} → {u.from}</div>;

  return (
    <div className="mt-3 border border-line rounded-xl p-3 bg-surface/40 space-y-2">
      <div className="text-xs text-ink-3">{locale === "de" ? "An" : locale === "en" ? "To" : "Kimə"}: <span className="text-ink-2 font-mono">{u.from}</span></div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)}
        className="w-full bg-surface border border-line focus:border-emerald-600/50 focus:outline-none text-ink rounded-lg px-3 py-2 text-sm" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={locale === "de" ? "Antwort schreiben…" : locale === "en" ? "Write a reply…" : "Cavabınızı yazın…"}
        className="w-full bg-surface border border-line focus:border-emerald-600/50 focus:outline-none text-ink rounded-lg px-3 py-2 text-sm placeholder:text-ink-3 resize-y" />
      {u.candidates.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-3">CV:</span>
          <select value={cvFor} onChange={(e) => setCvFor(e.target.value)}
            className="bg-card border border-line text-ink-2 rounded-lg px-2 py-1.5 text-xs">
            <option value="">{locale === "de" ? "kein CV" : locale === "en" ? "no CV" : "CV yox"}</option>
            {u.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="flex justify-end">
        <button onClick={send} disabled={sending || !text.trim()}
          className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 disabled:opacity-50">
          {sending ? "Göndərilir…" : (locale === "de" ? "Senden" : locale === "en" ? "Send" : "Göndər")}
        </button>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const catLabel = (c: string) => (CAT_LABELS[locale] ?? CAT_LABELS.az)[c] ?? c;
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("ALL");
  // "Unmatched replies": mailbox messages from a contacted employer that the
  // auto-matcher couldn't link to a candidate (answered from another address /
  // subject lost the code). On-demand IMAP scan so no reply stays invisible.
  const [unmatched, setUnmatched] = useState<UnmatchedReply[] | null>(null);
  const [scanning, setScanning] = useState(false);

  async function scanUnmatched() {
    setScanning(true);
    try {
      const res = await fetch("/api/inbox/unmatched");
      const data = await res.json();
      setUnmatched(Array.isArray(data.unmatched) ? data.unmatched : []);
    } catch {
      setUnmatched([]);
    } finally {
      setScanning(false);
    }
  }

  async function setOptOut(employerId: string, optedOut: boolean) {
    setReplies((prev) => prev.map((r) =>
      r.match.employer.id === employerId ? { ...r, match: { ...r.match, employer: { ...r.match.employer, optedOut } } } : r
    ));
    await fetch(`/api/employers/${employerId}/optout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optedOut }),
    }).catch(() => {});
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/inbox");
        const data = await res.json();
        setReplies(data.replies ?? []);
        // Seeing the inbox clears the notification badge.
        fetch("/api/inbox/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
          .then(() => window.dispatchEvent(new Event("inbox-read")))
          .catch(() => {});
      } finally {
        setLoading(false);
      }
    })();
    // Auto-pull unmatched mailbox replies in the background so EVERY reply shows
    // on this page without a manual scan — the matched list renders immediately,
    // the unmatched section fills in a few seconds later (IMAP read).
    void scanUnmatched();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const term = q.trim().toLowerCase();
  const list = replies.filter(
    (r) =>
      (cat === "ALL" || (r.replyCategory ?? "OTHER") === cat) &&
      (!term ||
        r.match.employer.name.toLowerCase().includes(term) ||
        r.match.candidate.name.toLowerCase().includes(term) ||
        (r.replySubject ?? "").toLowerCase().includes(term) ||
        (r.replyText ?? "").toLowerCase().includes(term))
  );
  // Category counts for the filter chips — matched AND unmatched, since both are
  // now classified, so a chip like "Sual verir" tallies replies from both.
  const catCount = (c: string) =>
    replies.filter((r) => (r.replyCategory ?? "OTHER") === c).length +
    (unmatched ?? []).filter((u) => (u.category ?? "OTHER") === c).length;

  // Unified feed: matched replies AND unmatched mailbox messages in ONE list,
  // newest first. Unmatched are classified too, so they honour the category
  // filter just like matched ones.
  const unmatchedShown = (unmatched ?? [])
    .filter((u) => cat === "ALL" || cat === "UNMATCHED" || (u.category ?? "OTHER") === cat)
    .filter(
      (u) => !term || u.from.toLowerCase().includes(term) || (u.subject ?? "").toLowerCase().includes(term) ||
        (u.snippet ?? "").toLowerCase().includes(term) || u.candidates.some((c) => c.name.toLowerCase().includes(term))
    );
  type MergedItem =
    | { kind: "matched"; date: string | null; r: Reply }
    | { kind: "unmatched"; date: string; u: UnmatchedReply; idx: number };
  const merged: MergedItem[] = [
    ...list.map((r): MergedItem => ({ kind: "matched", date: r.repliedAt, r })),
    ...unmatchedShown.map((u, idx): MergedItem => ({ kind: "unmatched", date: u.date, u, idx })),
  ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

  return (
    <div className="min-h-screen bg-surface">
      <TopNav active="inbox" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-green-400 to-emerald-600" />
            <div>
              <h1 className="text-xl font-bold text-ink flex items-center gap-2">
                {t("title")}
                {!loading && (replies.length + (unmatched?.length ?? 0)) > 0 && (
                  <span className="tabular text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">{replies.length + (unmatched?.length ?? 0)}</span>
                )}
              </h1>
              <p className="text-xs text-ink-3">{t("subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full bg-card border border-line focus:border-emerald-600/50 focus:outline-none text-ink rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-ink-3"
              />
            </div>
            {/* Refresh the mailbox scan (unmatched replies are auto-loaded too). */}
            <button
              onClick={scanUnmatched}
              disabled={scanning}
              title={locale === "de" ? "Postfach prüfen" : locale === "en" ? "Scan mailbox" : "Poçtu yoxla"}
              className="shrink-0 text-xs font-medium bg-card-2 hover:bg-line border border-line-strong text-ink-2 hover:text-ink rounded-lg px-3 py-2 inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {scanning
                ? <span className="w-3.5 h-3.5 border-2 border-ink-3/40 border-t-ink-2 rounded-full animate-spin" />
                : "🔄"}
              <span className="hidden sm:inline">{locale === "de" ? "Postfach" : locale === "en" ? "Mailbox" : "Poçt"}</span>
            </button>
          </div>
        </div>

        {/* AI category filter — what do the answers actually say? */}
        {!loading && (replies.length > 0 || (unmatched?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCat("ALL")}
              className={`text-xs font-medium rounded-full px-3 py-1.5 border ${cat === "ALL" ? "bg-accent/15 text-accent border-accent/40" : "bg-card-2 text-ink-2 border-line hover:text-ink"}`}
            >
              {locale === "de" ? "Alle" : locale === "en" ? "All" : "Hamısı"} {replies.length + (unmatched?.length ?? 0)}
            </button>
            {CATEGORIES.filter((c) => catCount(c) > 0).map((c) => (
              <button
                key={c}
                onClick={() => setCat(cat === c ? "ALL" : c)}
                className={`text-xs font-medium rounded-full px-3 py-1.5 border ${cat === c ? "bg-accent/15 text-accent border-accent/40" : "bg-card-2 text-ink-2 border-line hover:text-ink"}`}
              >
                {CAT_STYLE[c].icon} {catLabel(c)} {catCount(c)}
              </button>
            ))}
            {/* Dedicated chip: only the unmatched mailbox replies (from another
                address, not auto-linked to a candidate). */}
            {(unmatched?.length ?? 0) > 0 && (
              <button
                onClick={() => setCat(cat === "UNMATCHED" ? "ALL" : "UNMATCHED")}
                className={`text-xs font-medium rounded-full px-3 py-1.5 border ${cat === "UNMATCHED" ? "bg-amber-500/15 text-amber-300 border-amber-500/40" : "bg-card-2 text-ink-2 border-line hover:text-ink"}`}
              >
                📥 {locale === "de" ? "Nicht zugeordnet" : locale === "en" ? "Unmatched" : "Tanınmayan"} {unmatched?.length ?? 0}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card p-4">
                <div className="skeleton h-4 w-1/3 mb-2" />
                <div className="skeleton h-3 w-2/3 mb-1.5" />
                <div className="skeleton h-3 w-1/4" />
              </div>
            ))}
          </div>
        ) : merged.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-ink font-semibold mb-1">{q ? t("noResults") : t("noReplies")}</div>
            <div className="text-ink-3 text-sm max-w-sm mx-auto">{q ? t("noResultsHint") : t("noRepliesHint")}</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {merged.map((item) => {
              // Unmatched mailbox message — same collapsible card as a matched
              // reply (click to open), just with an amber "Tanınmayan" marker.
              if (item.kind === "unmatched") {
                const u = item.u;
                const umKey = `um-${item.idx}`;
                const isOpen = open === umKey;
                return (
                  <div key={umKey} className="bg-card border border-amber-500/25 rounded-2xl overflow-hidden">
                    <button onClick={() => setOpen(isOpen ? null : umKey)}
                      className="w-full text-left p-4 hover:bg-card-2/30 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-ink truncate">{u.fromName || u.from}</span>
                            {u.category && CAT_STYLE[u.category] && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${CAT_STYLE[u.category].cls}`}>
                                {CAT_STYLE[u.category].icon} {catLabel(u.category)}
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/25">📥 {locale === "de" ? "Nicht zugeordnet" : locale === "en" ? "Unmatched" : "Tanınmayan"}</span>
                          </div>
                          <div className="text-xs text-ink-3 mt-0.5 truncate">{u.subject}</div>
                          <div className="text-[11px] text-ink-3 mt-1">{u.from} · {fmt(u.date)}</div>
                        </div>
                        <span className={`shrink-0 text-ink-3 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-line/70 pt-3">
                        {u.snippet && <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed bg-surface/60 rounded-lg p-3 max-h-96 overflow-y-auto">{u.snippet}</div>}
                        {u.candidates.length > 0 && (
                          <div className="text-[11px] text-ink-3 mt-2">
                            {locale === "de" ? "Möglicher Kandidat" : locale === "en" ? "Likely candidate" : "Ehtimal olunan namizəd"}:{" "}
                            <span className="text-ink-2">{u.candidates.map((c) => c.name).join(", ")}</span>
                          </div>
                        )}
                        <UnmatchedComposer u={u} locale={locale} onSent={() => setOpen(null)} />
                      </div>
                    )}
                  </div>
                );
              }
              const r = item.r;
              const isOpen = open === r.id;
              return (
                <div key={r.id} className="bg-card border border-line rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className="w-full text-left p-4 hover:bg-card-2/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-ink truncate">{r.match.employer.name}</span>
                          {r.replyCategory && CAT_STYLE[r.replyCategory] && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${CAT_STYLE[r.replyCategory].cls}`}>
                              {CAT_STYLE[r.replyCategory].icon} {catLabel(r.replyCategory)}
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/15 text-green-300 border border-green-500/25">💬 {t("replyPill")}</span>
                          {r.match.employer.optedOut && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/15 text-red-300 border border-red-500/25">🚫 {t("optedOut")}</span>
                          )}
                        </div>
                        <div className="text-xs text-ink-3 mt-0.5 truncate">
                          {r.replySubject || r.match.vacancy.title}
                        </div>
                        <div className="text-[11px] text-ink-3 mt-1">
                          {t("forCandidate", { name: r.match.candidate.name })} · {fmt(r.repliedAt)}
                        </div>
                      </div>
                      <span className={`shrink-0 text-ink-3 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-line/70 pt-3">
                      <div className="text-xs text-ink-3 mb-2">
                        <span className="text-ink-3">{t("from")}:</span> {r.replyFrom || r.toAddress || "—"}
                      </div>
                      <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed bg-surface/60 rounded-lg p-3 max-h-96 overflow-y-auto">
                        {r.replyText || t("noText")}
                      </div>

                      {/* Our sent answers (thread) */}
                      {r.outboundReplies?.map((o) => (
                        <div key={o.id} className="mt-2 ml-6 border-l-2 border-emerald-600/40 pl-3">
                          <div className="text-[11px] text-emerald-500 mb-1">↩ Siz → {o.toAddress} · {fmt(o.createdAt)}</div>
                          <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed bg-emerald-600/5 rounded-lg p-3">{o.body}</div>
                          {o.attachments && o.attachments.length > 0 && (
                            <div className="text-[11px] text-ink-3 mt-1">📎 {o.attachments.map((a) => a.filename).join(", ")}</div>
                          )}
                        </div>
                      ))}

                      {/* Reply composer — answer straight from the app */}
                      <ReplyComposer
                        outreachId={r.id}
                        candidateName={r.match.candidate.name}
                        onSent={(reply) => setReplies((prev) => prev.map((x) =>
                          x.id === r.id ? { ...x, outboundReplies: [...x.outboundReplies, reply] } : x
                        ))}
                      />

                      <div className="flex items-center gap-3 mt-3">
                        {r.match.vacancy.url && (
                          <a href={r.match.vacancy.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline">🔗 {t("jobListing")}</a>
                        )}
                        {r.match.employer.optedOut ? (
                          <button onClick={() => setOptOut(r.match.employer.id, false)}
                            className="text-xs text-ink-2 hover:text-ink">↩ {t("restore")}</button>
                        ) : (
                          <button onClick={() => setOptOut(r.match.employer.id, true)}
                            className="text-xs text-red-400 hover:text-red-300">🚫 {t("stopSending")}</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
