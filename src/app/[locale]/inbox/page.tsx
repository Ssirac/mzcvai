"use client";

import { useEffect, useState } from "react";
import TopNav from "../_components/TopNav";

interface Reply {
  id: string;
  repliedAt: string | null;
  replyFrom: string | null;
  replySubject: string | null;
  replyText: string | null;
  toAddress: string | null;
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

export default function InboxPage() {
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
    <div className="min-h-screen bg-gray-950">
      <TopNav active="inbox" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-8 rounded-full bg-gradient-to-b from-green-400 to-emerald-600" />
            <div>
              <h1 className="text-xl font-bold text-white">Gələn maillər</h1>
              <p className="text-xs text-gray-500">İşəgötürənlərdən gələn cavablar</p>
            </div>
          </div>
          <div className="relative w-full sm:w-72">
            <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Şirkət, namizəd, mətn axtar..."
              className="w-full bg-gray-900 border border-gray-800 focus:border-emerald-600/50 focus:outline-none text-white rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-gray-600"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-8 text-center">Yüklənir...</div>
        ) : list.length === 0 ? (
          <div className="text-gray-500 text-sm bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            Hələ cavab gəlməyib. İşəgötürən cavab verəndə burada görünəcək.
          </div>
        ) : (
          <div className="space-y-2.5">
            {list.map((r) => {
              const isOpen = open === r.id;
              return (
                <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className="w-full text-left p-4 hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white truncate">{r.match.employer.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/15 text-green-300 border border-green-500/25">💬 cavab</span>
                          {r.match.employer.optedOut && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/15 text-red-300 border border-red-500/25">🚫 əlaqə saxlanmır</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5 truncate">
                          {r.replySubject || r.match.vacancy.title}
                        </div>
                        <div className="text-[11px] text-gray-600 mt-1">
                          {r.match.candidate.name} üçün · {fmt(r.repliedAt)}
                        </div>
                      </div>
                      <span className={`shrink-0 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-gray-800/70 pt-3">
                      <div className="text-xs text-gray-500 mb-2">
                        <span className="text-gray-600">Kimdən:</span> {r.replyFrom || r.toAddress || "—"}
                      </div>
                      <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed bg-gray-950/60 rounded-lg p-3 max-h-96 overflow-y-auto">
                        {r.replyText || "(mətn yoxdur)"}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        {r.match.vacancy.url && (
                          <a href={r.match.vacancy.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline">🔗 İş elanı</a>
                        )}
                        {r.match.employer.optedOut ? (
                          <button onClick={() => setOptOut(r.match.employer.id, false)}
                            className="text-xs text-gray-400 hover:text-gray-200">↩ Əlaqəni bərpa et</button>
                        ) : (
                          <button onClick={() => setOptOut(r.match.employer.id, true)}
                            className="text-xs text-red-400 hover:text-red-300">🚫 Bu şirkətə bir daha göndərmə</button>
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
