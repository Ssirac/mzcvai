import { NextRequest, NextResponse } from "next/server";
import { pollReplies } from "@/services/replies";
import { runFollowUps } from "@/services/followup";
import { deletePartTimeVacancies, deleteExpiredVacancies, deleteNonGermanVacancies, collapseCrossSourceDuplicates, pruneCrossFieldMatches } from "@/services/cleanup";
import { sweepDeadVacancies } from "@/services/scraper/deadCheck";
import { runApplyScan } from "@/services/applyScanner";
import { withCronLock } from "@/services/cron";
import { availableSources } from "@/services/sources/registry";
import { matchCandidateToVacancies } from "@/services/scoring";
import { candidateProfiles } from "@/lib/candidateProfiles";
import { runAutoSend } from "@/services/autopilot";
import { runScrapeCycle } from "@/services/scraper/cycle";
import { sendDailyDigest } from "@/services/digest";
import { prisma } from "@/lib/prisma";
import { log as logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Jobs that legitimately take minutes (many live source fetches, a headless
// browser, re-matching every candidate). Railway runs one persistent Node
// process, so we can start these detached and let them finish after we respond
// — the caller (GitHub Actions cron / curl) gets an instant 202 instead of
// waiting 5 minutes and timing out. withCronLock still guarantees single-flight.
const HEAVY_JOBS = new Set(["refresh", "scrape", "applyscan"]);

async function runHeavyJob(job: string): Promise<void> {
  try {
    if (job === "refresh") {
      await withCronLock("refresh", 30 * 60 * 1000, async () => ({
        refresh: await refreshJobs(),
        autoSend: await runAutoSend(),
      }));
    } else if (job === "scrape") {
      await withCronLock("scrape", 55 * 60 * 1000, () => runScrapeCycle());
    } else if (job === "applyscan") {
      await withCronLock("applyscan", 30 * 60 * 1000, () => runApplyScan());
    }
  } catch (err) {
    // withCronLock records failures itself; this only guards against an
    // unexpected throw so it never becomes an unhandled rejection.
    logger.error("cron.background_failed", { job, error: (err as Error).message });
  }
}

// Intraday refresh: pull fresh listings for each ACTIVE candidate's occupation
// from every available source (1 page each — new postings surface at the top),
// then re-match, so new vacancies land in the app within hours, not next day.
// The nightly run stays the deep pass (more pages + core occupations).
async function refreshJobs(): Promise<{ searches: number; vacanciesNew: number; matched: number }> {
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { id: true, beruf: true, desiredPosition: true, experience: true },
  });

  // Search every occupation from the FULL CV (desired position, beruf, and the
  // CV's experience titles) — not just the primary field — so sources are
  // queried for everything the candidate can actually do.
  const berufe = new Set<string>();
  for (const c of candidates) {
    for (const p of candidateProfiles(c)) berufe.add(p);
  }

  const sources = availableSources();
  let vacanciesNew = 0;
  for (const beruf of Array.from(berufe).slice(0, 30)) {
    for (const src of sources) {
      try {
        const r = await src.ingest({ beruf, region: "Deutschland", maxPages: 1 });
        vacanciesNew += r.vacanciesNew;
      } catch { /* one bad source/search must not stop the refresh */ }
    }
  }

  // ALWAYS re-match — even with zero brand-new vacancies. Ingest refreshes
  // lastSeenAt on re-listed jobs (they become "fresh" again), the scrape cycle
  // may have added inventory since the last pass, and criteria changes need a
  // re-run. Gating this on vacanciesNew > 0 silently starved candidates of
  // new matches whenever page-1 of every source was already known.
  let matched = 0;
  for (const c of candidates) {
    try {
      const m = await matchCandidateToVacancies(c.id);
      matched += m.matched;
    } catch { /* keep going */ }
  }

  return { searches: berufe.size, vacanciesNew, matched };
}

// POST /api/cron/maintenance?job=replies|followups|cleanup|all
// Secret-guarded (x-cron-secret) recurring maintenance, called by the in-process
// scheduler (src/instrumentation.ts) and usable by any external cron too.
// Runs in the Node.js runtime so IMAP (imapflow) and SMTP (nodemailer) work.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = req.nextUrl.searchParams.get("job") ?? "all";

  // Heavy jobs run detached so the caller never waits (and never times out).
  if (HEAVY_JOBS.has(job)) {
    void runHeavyJob(job);
    return NextResponse.json({ ok: true, job, status: "started" }, { status: 202 });
  }

  const log: Record<string, unknown> = {};

  try {
    if (job === "replies" || job === "all") {
      log.replies = await pollReplies();
    }
    // Keep the DB full-time-only, Germany-only and free of stale postings.
    if (job === "cleanup" || job === "replies" || job === "all") {
      log.partTime = await deletePartTimeVacancies();
      log.nonGerman = await deleteNonGermanVacancies();
      log.expired = await deleteExpiredVacancies();
      // Collapse the same job re-listed by multiple sources (JSearch overlap).
      log.duplicates = await collapseCrossSourceDuplicates();
      // Remove wrong-specialization matches (logistics↔IT) directly — no ingest,
      // so they clear on the 30-min cleanup tick instead of waiting for a rematch.
      log.crossField = await pruneCrossFieldMatches();
    }
    // Cross-source dead-listing sweep (visits URLs) — only on the dedicated
    // cleanup tick, not every reply poll, since it drives a headless browser.
    if ((job === "cleanup" || job === "all") && process.env.DEAD_SWEEP_ENABLED !== "false") {
      log.deadSwept = await sweepDeadVacancies();
    }
    if (job === "followups" || job === "all") {
      // Make sure replies are current right before follow-ups, so we never chase
      // an employer who already answered.
      if (job === "followups") log.replies = await pollReplies();
      log.followups = await runFollowUps();
    }
    if (job === "autosend") {
      log.autoSend = await runAutoSend();
    }
    if (job === "digest") {
      log.digest = await sendDailyDigest();
    }
    // Note: refresh / scrape / applyscan are handled above as detached HEAVY_JOBS.
    return NextResponse.json({ ok: true, job, ...log });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message, ...log }, { status: 500 });
  }
}
