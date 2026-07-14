"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { jsonFetch } from "@/lib/clientApi";

interface Attention {
  unansweredReplies: number;
  queueReady: number;
  queueVerify: number;
  queueTotal: number;
  interviews: number;
}

// "Bu gün diqqət tələb edir" — one glance at what the user needs to do now, with
// direct links to the right screen. Hidden entirely when there's nothing to do.
export default function AttentionCard() {
  const [a, setA] = useState<Attention | null>(null);
  const pathname = usePathname();
  const locale = (pathname?.split("/")[1] || "az");

  useEffect(() => {
    let alive = true;
    jsonFetch("/api/attention").then((r) => { if (alive) setA(r.data as unknown as Attention); });
    return () => { alive = false; };
  }, []);

  if (!a) return null;
  const nothing = a.unansweredReplies === 0 && a.queueTotal === 0 && a.interviews === 0;
  if (nothing) return null;

  const tiles = [
    { show: a.unansweredReplies > 0, href: `/${locale}/inbox`, n: a.unansweredReplies, label: "cavab gözləyir", icon: "✉️", cls: "from-green-500/15 to-emerald-600/10 text-emerald-500" },
    { show: a.queueReady > 0, href: `/${locale}/captcha-queue`, n: a.queueReady, label: "hazır forma", icon: "✅", cls: "from-sky-500/15 to-blue-600/10 text-sky-500" },
    { show: a.queueVerify > 0, href: `/${locale}/captcha-queue`, n: a.queueVerify, label: "captcha/OTP", icon: "🔒", cls: "from-amber-400/15 to-orange-600/10 text-amber-500" },
    { show: a.interviews > 0, href: `/${locale}/applications`, n: a.interviews, label: "müsahibə/təklif", icon: "⭐", cls: "from-violet-500/15 to-purple-600/10 text-violet-500" },
  ].filter((tt) => tt.show);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink flex items-center gap-2">🔔 Bu gün diqqət tələb edir</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((tt, i) => (
          <a key={i} href={tt.href}
            className={`bg-gradient-to-br ${tt.cls} border border-line rounded-xl p-3 hover:brightness-110 transition`}>
            <div className="text-2xl font-bold tabular-nums flex items-center gap-1.5">{tt.icon} {tt.n}</div>
            <div className="text-xs text-ink-2 mt-1">{tt.label}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
