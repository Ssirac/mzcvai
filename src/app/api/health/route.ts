import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendingPause } from "@/services/deliverability";
import { SOURCES } from "@/services/sources/registry";
import { freshVacancyWhere, notRejectedWhere, undispatchedWhere } from "@/lib/matchFilters";
import { occupationClusters } from "@/lib/occupationFamily";
import type { OutreachStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// IMAP reachability check — connects to the reply mailbox with the same creds
// pollReplies uses and reports login success + INBOX message count. Confirms
// whether employer replies can be read at all (e.g. after an IONOS password
// rotation that wasn't mirrored to Railway). Opens a real socket → deep only.
async function imapCheck(): Promise<{ configured: boolean; ok: boolean; error: string | null; inboxMessages: number | null }> {
  const host = process.env.IMAP_HOST || "imap.ionos.de";
  const port = parseInt(process.env.IMAP_PORT || "993");
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  if (!user || !pass) return { configured: false, ok: false, error: "no IMAP/SMTP credentials set", inboxMessages: null };
  try {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
    await client.connect();
    let inboxMessages: number | null = null;
    const lock = await client.getMailboxLock("INBOX");
    try {
      inboxMessages = typeof client.mailbox === "object" && client.mailbox ? client.mailbox.exists : null;
    } finally {
      lock.release();
    }
    await client.logout();
    return { configured: true, ok: true, error: null, inboxMessages };
  } catch (e) {
    return { configured: true, ok: false, error: (e as Error).message.slice(0, 200), inboxMessages: null };
  }
}

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

// The ACTUAL matched-job list for ONE non-IT candidate (only on ?deep=1&sample=1)
// — the data-level equivalent of opening that candidate and reading their
// "Uyğun işlər" list. Picks the non-IT candidate with the most matches, returns
// their real vacancy titles (capped), each flagged pureIT = classifies as IT
// with NO overlap of the candidate's core field (a true wrong-field IT job).
// Every pureIT should be false. No candidate name — occupation + titles only.
async function sampleCandidateTitles(): Promise<{
  occupation: string; core: string[]; total: number; shown: number;
  pureItCount: number; titles: { title: string; pureIT: boolean }[];
} | null> {
  try {
    const candidates = await prisma.candidate.findMany({
      where: { status: { in: ["ACTIVE", "PENDING"] } },
      select: { id: true, desiredPosition: true, beruf: true },
    });
    // Choose the non-IT candidate (core known, excludes "it") with the most matches.
    let best: { id: string; occ: string; core: Set<string>; count: number } | null = null;
    for (const c of candidates) {
      const core = new Set<string>();
      for (const t of [c.desiredPosition, c.beruf]) if (t && t.trim()) for (const cl of occupationClusters(t)) core.add(cl);
      if (core.size === 0 || core.has("it")) continue;
      const count = await prisma.match.count({
        where: { candidateId: c.id, vacancy: freshVacancyWhere(), ...notRejectedWhere(), ...undispatchedWhere() },
      });
      if (!best || count > best.count) best = { id: c.id, occ: (c.desiredPosition || c.beruf || "?").slice(0, 45), core, count };
    }
    if (!best) return null;

    const rows = await prisma.match.findMany({
      where: { candidateId: best.id, vacancy: freshVacancyWhere(), ...notRejectedWhere(), ...undispatchedWhere() },
      select: { vacancy: { select: { title: true } } },
      orderBy: { fitScore: "desc" },
      take: 60,
    });
    const titles = rows.map((r) => {
      const cls = occupationClusters(r.vacancy.title);
      const pureIT = cls.has("it") && !Array.from(cls).some((cl) => best!.core.has(cl));
      return { title: r.vacancy.title.slice(0, 70), pureIT };
    });
    return {
      occupation: best.occ,
      core: Array.from(best.core),
      total: best.count,
      shown: titles.length,
      pureItCount: titles.filter((t) => t.pureIT).length,
      titles,
    };
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
    pendingWithEmail: number; pendingNoEmail: number; candidatesWithCv: number;
    repliesStored: number;
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
    // WHY aren't more mails going out? Auto-send needs (a) an employer generic
    // email and (b) a candidate with a CV. Split the pending pool so we can see
    // if it's an email-discovery gap, a missing-CV gap, or genuinely all sent.
    const [pendingWithEmail, pendingNoEmail, candidatesWithCv, repliesStored] = await Promise.all([
      prisma.match.count({ where: { vacancy: freshVacancyWhere(), ...notRejectedWhere(), outreach: { none: dispatchedFilter }, employer: { genericEmail: { not: null }, optedOut: false } } }),
      prisma.match.count({ where: { vacancy: freshVacancyWhere(), ...notRejectedWhere(), outreach: { none: dispatchedFilter }, employer: { genericEmail: null } } }),
      prisma.candidate.count({ where: { status: { in: ["ACTIVE", "PENDING"] }, cvData: { not: null } } }),
      prisma.outreach.count({ where: { repliedAt: { not: null } } }),
    ]);
    data = {
      activeVacancies, freshVacancies, activeCandidates, matches, freshMatches,
      freshBad, freshDispatched, freshVisible, pendingAnyVacancy, totalDispatchedOutreach, totalBad,
      pendingWithEmail, pendingNoEmail, candidatesWithCv, repliesStored,
    };
  } catch { /* ignore */ }

  // Reply-reading (IMAP) health — the mailbox we poll for employer replies.
  // Sending goes via Resend, but replies land in the IONOS inbox and are read
  // over IMAP with IMAP_USER/PASS (falling back to SMTP_USER/PASS). If the IONOS
  // password was rotated but Railway still has the old one, sending keeps working
  // while reply-reading silently breaks. Only on ?deep=1 (opens a real socket).
  const imap = deep ? await imapCheck() : undefined;

  // Cross-field match diagnostic — only when explicitly requested (heavier scan).
  const crossField = deep ? await crossFieldDiagnostic() : undefined;
  const byCandidate = deep ? await candidateFieldBreakdown() : undefined;
  // ?sample=1 (with deep): the ACTUAL job-title list one non-IT candidate sees —
  // the data-level "open a candidate and look at their Uyğun işlər". Each title
  // flagged pureIT (classifies as IT with no core overlap) — should all be false.
  const sample = deep && req.nextUrl.searchParams.get("sample") === "1" ? await sampleCandidateTitles() : undefined;

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
    ...(imap !== undefined ? { imap } : {}), // reply-mailbox reachability, only on ?deep=1
    ...(crossField !== undefined ? { crossField } : {}), // only on ?deep=1
    ...(byCandidate !== undefined ? { byCandidate } : {}), // per-candidate field breakdown, only on ?deep=1
    ...(sample !== undefined ? { sample } : {}), // one candidate's real job list, only on ?deep=1&sample=1
    time: new Date().toISOString(),
  });
}
