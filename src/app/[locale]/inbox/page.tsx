"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
  toAddress: string | null;
  outboundReplies: OutboundReply[];
  match: {
    candidate: { id: string; name: string };
    employer: { id: string; name: string; optedOut: boolean };
    vacancy: { title: string; url: string | null };
  };
}

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

// German quick-reply templates for the most common employer follow-ups. `cv`
// marks the one that should also attach the candidate's CV.
function replyTemplates(candidate: string): { label: string; text: string; cv?: boolean }[] {
  const sig = "\n\nMit freundlichen Grüßen\nMZ Personalvermittlung";
  return [
    { label: "📎 CV göndər", cv: true,
      text: `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihr Interesse. Anbei erhalten Sie den Lebenslauf von ${candidate}. Für Rückfragen stehen wir Ihnen gerne zur Verfügung.${sig}` },
    { label: "📅 Müsahibə təklif et",
      text: `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Rückmeldung. Gerne vereinbaren wir ein Vorstellungsgespräch mit ${candidate}. Welche Termine würden Ihnen in den kommenden Tagen passen?${sig}` },
    { label: "🙏 Təşəkkür / maraqlıyıq",
      text: `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Nachricht — ${candidate} hat großes Interesse an der Position. Gerne besprechen wir die nächsten Schritte.${sig}` },
  ];
}

// Reply straight from the app (no IONOS webmail), with quick templates, the
// candidate's CV in one click, and optional file attachments.
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
      <div className="flex flex-wrap gap-1.5">
        {replyTemplates(candidateName).map((tpl, i) => (
          <button key={i}
            onClick={() => { setText(tpl.text); if (tpl.cv) setAttachCv(true); }}
            className="text-[11px] bg-card border border-line-strong text-ink-2 hover:text-ink hover:bg-line rounded-full px-2.5 py-1">
            {tpl.label}
          </button>
        ))}
      </div>
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
            {attachCv ? "✓ " : ""}CV qoşulu
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

export default function InboxPage() {
  const t = useTranslations("inbox");
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

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
  }, []);

  const term = q.trim().toLowerCase();
  const list = replies.filter(
    (r) =>
      !term ||
      r.match.employer.name.toLowerCase().includes(term) ||
      r.match.candidate.name.toLowerCase().includes(term) ||
      (r.replySubject ?? "").toLowerCase().includes(term) ||
      (r.replyText ?? "").toLowerCase().includes(term)
  );

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
                {!loading && list.length > 0 && (
                  <span className="tabular text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent">{list.length}</span>
                )}
              </h1>
              <p className="text-xs text-ink-3">{t("subtitle")}</p>
            </div>
          </div>
          <div className="relative w-full sm:w-72">
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
        </div>

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
        ) : list.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-ink font-semibold mb-1">{q ? t("noResults") : t("noReplies")}</div>
            <div className="text-ink-3 text-sm max-w-sm mx-auto">{q ? t("noResultsHint") : t("noRepliesHint")}</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {list.map((r) => {
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
