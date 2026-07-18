import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendingPause } from "@/services/deliverability";
import { SOURCES } from "@/services/sources/registry";
import { freshVacancyWhere, notRejectedWhere } from "@/lib/matchFilters";
import type { OutreachStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + DB + mail provider + critical-config status.
 * PUBLIC (no auth), so it exposes ONLY booleans/enums — never secret values
 * (host/user/from/keys). Previously it leaked SMTP host/user/from; now redacted.
 */
export async function GET() {
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
    time: new Date().toISOString(),
  });
}
