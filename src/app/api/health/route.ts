import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendingPause } from "@/services/deliverability";
import { SOURCES } from "@/services/sources/registry";
import { freshVacancyWhere, notRejectedWhere, undispatchedWhere } from "@/lib/matchFilters";
import { occupationClusters } from "@/lib/occupationFamily";
import type { OutreachStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// Cross-field diagnostic (only on ?deep=1 — it scans the visible matches, too
// heavy for every monitoring ping). Counts matches whose candidate CORE
// occupation (desired position + beruf) and vacancy title BOTH classify into
// clusters that DON'T overlap — i.e. a wrong-specialization match (logistics↔IT).
// After the specialization-anchor fix rematches, this should sit at ~0. Also
// returns a few example occupation→title pairs (no names/PII) for insight.
async function crossFieldDiagnostic(): Promise<{
  scanned: number; crossField: number; examples: string[];
} | null> {
  try {
    const rows = await prisma.match.findMany({
      where: { vacancy: freshVacancyWhere(), ...notRejectedWhere(), ...undispatchedWhere() },
      select: {
        candidate: { select: { desiredPosition: true, beruf: true } },
        vacancy: { select: { title: true } },
      },
      take: 5000,
    });

    // Cache clusters per distinct core string so we don't recompute per row.
    const coreCache = new Map<string, Set<string>>();
    const coreClustersFor = (dp: string | null, b: string | null): Set<string> => {
      const key = `${dp ?? ""}|${b ?? ""}`;
      let c = coreCache.get(key);
      if (!c) {
        c = new Set<string>();
        for (const t of [dp, b]) if (t && t.trim()) for (const cl of occupationClusters(t)) c.add(cl);
        coreCache.set(key, c);
      }
      return c;
    };

    let crossField = 0;
    const examples: string[] = [];
    for (const r of rows) {
      const core = coreClustersFor(r.candidate.desiredPosition, r.candidate.beruf);
      if (core.size === 0) continue;
      const vac = occupationClusters(r.vacancy.title);
      if (vac.size === 0) continue;
      const overlap = Array.from(vac).some((c) => core.has(c));
      if (!overlap) {
        crossField++;
        if (examples.length < 8) {
          const coreStr = (r.candidate.desiredPosition || r.candidate.beruf || "").slice(0, 40);
          examples.push(`${coreStr} → ${r.vacancy.title.slice(0, 45)}`);
        }
      }
    }
    return { scanned: rows.length, crossField, examples };
  } catch {
    return null;
  }
}

// Per-candidate cluster breakdown (only on ?deep=1): for each active candidate,
// their CORE occupation field(s) and which fields the jobs currently matched to
// them fall into — the data-level equivalent of "open a candidate and check no
// IT jobs come to a non-IT person". `foreign` lists any matched cluster outside
// the core (should always be empty now); `it` is called out explicitly since
// that was the operator's example. No names — occupation category + counts only.
async function candidateFieldBreakdown(): Promise<Array<{
  occupation: string; core: string[]; matched: number;
  byField: Record<string, number>; pureForeign: number; itTitles: string[];
}> | null> {
  try {
    const candidates = await prisma.candidate.findMany({
      where: { status: { in: ["ACTIVE", "PENDING"] } },
      select: { id: true, desiredPosition: true, beruf: true },
    });
    const out = [];
    for (const c of candidates) {
      const core = new Set<string>();
      for (const t of [c.desiredPosition, c.beruf]) if (t && t.trim()) for (const cl of occupationClusters(t)) core.add(cl);
      const matches = await prisma.match.findMany({
        where: { candidateId: c.id, vacancy: freshVacancyWhere(), ...notRejectedWhere(), ...undispatchedWhere() },
        select: { vacancy: { select: { title: true } } },
        take: 3000,
      });
      const byField: Record<string, number> = {};
      // pureForeign = a match whose clusters ALL fall OUTSIDE the core (the real
      // wrong-field case). A match that shares one core cluster is legitimate even
      // if its title also touches another field (e.g. "Lager … mit IT-Kenntnissen"
      // classifies {logistics, it} but is a logistics job). byField counts every
      // cluster, so its "it" tally can be >0 without any PURE IT job.
      let pureForeign = 0;
      const itTitles: string[] = [];
      const coreKnown = core.size > 0;
      for (const m of matches) {
        const cls = occupationClusters(m.vacancy.title);
        for (const cl of cls) byField[cl] = (byField[cl] ?? 0) + 1;
        if (coreKnown && cls.size > 0 && !Array.from(cls).some((cl) => core.has(cl))) pureForeign++;
        if (coreKnown && !core.has("it") && cls.has("it") && itTitles.length < 3) itTitles.push(m.vacancy.title.slice(0, 55));
      }
      out.push({
        occupation: (c.desiredPosition || c.beruf || "?").slice(0, 45),
        core: Array.from(core),
        matched: matches.length,
        byField,
        pureForeign,        // MUST be 0 — a truly off-field match
        itTitles,           // IT-tagged titles for a non-IT candidate (should read as core-field jobs mentioning IT)
      });
    }
    out.sort((a, b) => b.pureForeign - a.pureForeign || b.matched - a.matched);
    return out;
  } catch {
    return null;
  }
}

/**
 * GET /api/health — liveness + DB + mail provider + critical-config status.
 * PUBLIC (no auth), so it exposes ONLY booleans/enums — never secret values
 * (host/user/from/keys). Previously it leaked SMTP host/user/from; now redacted.
 */
export async function GET(req: NextRequest) {
  // ?deep=1 adds the (heavier) cross-field diagnostic; plain calls stay cheap.
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch { /* db stays down */ }

  // Which mail transport is configured (booleans only, no values).
  const gmail = !!(process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  const resend = !!process.env.RESEND_API_KEY;
  const smtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const mailProvider = gmail ? "gmail" : resend ? "resend" : smtp ? "smtp" : "none";

  const config = {
    cronSecret: !!process.env.CRON_SECRET,
    sessionSecret: !!process.env.NEXTAUTH_SECRET,
    adminPassword: !!process.env.ADMIN_PASSWORD,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    databaseUrl: !!process.env.DATABASE_URL,
    testMode: !!process.env.OUTREACH_TEST_RECIPIENT,
  };

  // Deliverability pause snapshot (aggregate, no PII). sent/bounced expose the
  // last-48h VOLUME so auto-pilot activity is observable without DB access —
  // rate alone reads 0 both when everything works and when nothing sends.
  let sending: { paused: boolean; reason: string | null; rate: number; sent48h: number; bounced48h: number } | null = null;
  try {
    const p = await sendingPause();
    sending = {
      paused: p.paused, reason: p.reason, rate: Number(p.stats.rate.toFixed(3)),
      sent48h: p.stats.sent, bounced48h: p.stats.bounced,
    };
  } catch { /* ignore */ }

  // Job-source availability snapshot (ids + booleans only — no keys/values), so
  // a newly-added source key (e.g. RAPIDAPI_KEY for JSearch) can be confirmed
  // live without authenticating. `active` = the module is usable right now.
  const sources = SOURCES.map((s) => ({ id: s.id, active: s.available() }));

  // Aggregate data-health counts (numbers only, no PII) — lets us diagnose an
  // empty candidate view without DB access: is the vacancy pool depleted, or are
  // matches just not being created?
  let data: {
    activeVacancies: number; freshVacancies: number; activeCandidates: number;
    matches: number; freshMatches: number;
    freshBad: number; freshDispatched: number; freshVisible: number;
    pendingAnyVacancy: number; totalDispatchedOutreach: number; totalBad: number;
  } | null = null;
  try {
    const [activeVacancies, freshVacancies, activeCandidates, matches, freshMatches] = await Promise.all([
      prisma.vacancy.count({ where: { status: "ACTIVE" } }),
      prisma.vacancy.count({ where: freshVacancyWhere() }),
      prisma.candidate.count({ where: { status: { in: ["ACTIVE", "PENDING"] } } }),
      prisma.match.count(),
      prisma.match.count({ where: { vacancy: freshVacancyWhere() } }),
    ]);
    // Breakdown of WHY fresh matches may be invisible: dispatched vs rejected vs
    // the two filters together, plus totals. Pinpoints the cause without DB access.
    const dispatchedFilter = { OR: [{ sentAt: { not: null } }, { status: { in: ["SENT", "OPENED", "REPLIED", "BOUNCED"] as OutreachStatus[] } }] };
    const [freshBad, freshDispatched, freshVisible, pendingAnyVacancy, totalDispatchedOutreach, totalBad] = await Promise.all([
      prisma.match.count({ where: { vacancy: freshVacancyWhere(), feedback: "BAD" } }),
      prisma.match.count({ where: { vacancy: freshVacancyWhere(), outreach: { some: dispatchedFilter } } }),
      prisma.match.count({ where: { vacancy: freshVacancyWhere(), ...notRejectedWhere(), outreach: { none: dispatchedFilter } } }),
      prisma.match.count({ where: { ...notRejectedWhere(), outreach: { none: dispatchedFilter } } }),
      prisma.outreach.count({ where: { sentAt: { not: null } } }),
      prisma.match.count({ where: { feedback: "BAD" } }),
    ]);
    data = {
      activeVacancies, freshVacancies, activeCandidates, matches, freshMatches,
      freshBad, freshDispatched, freshVisible, pendingAnyVacancy, totalDispatchedOutreach, totalBad,
    };
  } catch { /* ignore */ }

  // Cross-field match diagnostic — only when explicitly requested (heavier scan).
  const crossField = deep ? await crossFieldDiagnostic() : undefined;
  const byCandidate = deep ? await candidateFieldBreakdown() : undefined;

  const healthy = db === "up" && mailProvider !== "none" && config.cronSecret && config.sessionSecret;

  return NextResponse.json({
    status: healthy ? "ok" : "degraded",
    db,
    mailProvider,        // gmail | resend | smtp | none — no host/user/from
    mailConfigured: mailProvider !== "none",
    config,              // booleans only
    sending,
    sources,             // { id, active } — no secret values
    data,                // aggregate counts — no PII
    ...(crossField !== undefined ? { crossField } : {}), // only on ?deep=1
    ...(byCandidate !== undefined ? { byCandidate } : {}), // per-candidate field breakdown, only on ?deep=1
    time: new Date().toISOString(),
  });
}
