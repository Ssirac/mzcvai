import { NextRequest, NextResponse } from "next/server";
import { pollReplies } from "@/services/replies";
import { runFollowUps } from "@/services/followup";
import { deletePartTimeVacancies, deleteExpiredVacancies } from "@/services/cleanup";
import { availableSources } from "@/services/sources/registry";
import { matchCandidateToVacancies } from "@/services/scoring";
import { runAutoSend } from "@/services/autopilot";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Intraday refresh: pull fresh listings for each ACTIVE candidate's occupation
// from every available source (1 page each — new postings surface at the top),
// then re-match, so new vacancies land in the app within hours, not next day.
// The nightly run stays the deep pass (more pages + core occupations).
async function refreshJobs(): Promise<{ searches: number; vacanciesNew: number; matched: number }> {
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { id: true, beruf: true, desiredPosition: true },
  });

  const berufe = new Set<string>();
  for (const c of candidates) {
    for (const raw of [c.desiredPosition, c.beruf]) {
      const b = raw?.trim();
      if (b && b.length >= 3) berufe.add(b);
    }
  }

  const sources = availableSources();
  let vacanciesNew = 0;
  for (const beruf of Array.from(berufe).slice(0, 20)) {
    for (const src of sources) {
      try {
        const r = await src.ingest({ beruf, region: "Deutschland", maxPages: 1 });
        vacanciesNew += r.vacanciesNew;
      } catch { /* one bad source/search must not stop the refresh */ }
    }
  }

  let matched = 0;
  if (vacanciesNew > 0) {
    for (const c of candidates) {
      try {
        const m = await matchCandidateToVacancies(c.id);
        matched += m.matched;
      } catch { /* keep going */ }
    }
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
  const log: Record<string, unknown> = {};

  try {
    if (job === "replies" || job === "all") {
      log.replies = await pollReplies();
    }
    // Keep the DB full-time-only and free of stale postings on every pass.
    if (job === "cleanup" || job === "replies" || job === "all") {
      log.partTime = await deletePartTimeVacancies();
      log.expired = await deleteExpiredVacancies();
    }
    if (job === "followups" || job === "all") {
      // Make sure replies are current right before follow-ups, so we never chase
      // an employer who already answered.
      if (job === "followups") log.replies = await pollReplies();
      log.followups = await runFollowUps();
    }
    // Intraday job refresh — new vacancies land within hours, not next day.
    // Auto-pilot then sends applications for the fresh matches immediately.
    if (job === "refresh") {
      log.refresh = await refreshJobs();
      log.autoSend = await runAutoSend();
    }
    if (job === "autosend") {
      log.autoSend = await runAutoSend();
    }
    return NextResponse.json({ ok: true, job, ...log });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message, ...log }, { status: 500 });
  }
}
