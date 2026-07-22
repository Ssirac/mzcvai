/**
 * Nightly cron — POST /api/cron/nightly
 * Secured with CRON_SECRET header.
 * Sequence: ingest → enrich → score → match all active candidates
 */

import { NextRequest, NextResponse } from "next/server";
import { enrichPendingEmployers } from "@/services/enrichment";
import { scoreEmployersForSearch, matchCandidateToVacancies } from "@/services/scoring";
import { availableSources } from "@/services/sources/registry";
import { pollReplies, reconcileReplies } from "@/services/replies";
import { runFollowUps } from "@/services/followup";
import { runAutoSend } from "@/services/autopilot";
import { deletePartTimeVacancies, deleteNonGermanVacancies, deleteExpiredVacancies } from "@/services/cleanup";
import { mergeDuplicateEmployers } from "@/services/dedup";
import { acquireCronLock, releaseCronLock } from "@/services/cron";
import { candidateProfiles } from "@/lib/candidateProfiles";
import { prisma } from "@/lib/prisma";

// Core occupations always covered nightly.
const CORE_BERUFE = [
  "Housekeeping", "Koch", "Beikoch", "Service", "Rezeption", "Restaurantfachmann",
  "Hotelfachmann", "Küchenhilfe", "Spülkraft", "Reinigungskraft",
  "Lagerhelfer", "Produktionshelfer", "Verpackungshelfer", "Staplerfahrer",
  "LKW-Fahrer", "Pflegehelfer", "Bauhelfer",
];

// The nightly search list = what ACTIVE candidates actually need FIRST (their
// full-CV occupation profiles — desired position, beruf, experience titles),
// then the core occupations fill the remaining slots. Candidate berufe lead
// because the cap below truncates the tail: with core first, a candidate
// outside the core list could lose their nightly search entirely once the
// matrix filled up — the exact people the deep pass exists for.
async function buildNightlySearches(): Promise<{ beruf: string; region: string }[]> {
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { beruf: true, desiredPosition: true, experience: true },
  });
  const berufe = new Set<string>();
  for (const c of candidates) {
    for (const p of candidateProfiles(c)) berufe.add(p);
  }
  for (const core of CORE_BERUFE) berufe.add(core); // Set keeps first-insertion order
  // Cap the matrix so the run stays within a sane duration.
  return Array.from(berufe).slice(0, 30).map((beruf) => ({ beruf, region: "Deutschland" }));
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Single-flight: a second nightly (overlap / another instance) must not run.
  const lockOwner = await acquireCronLock("nightly", 3 * 60 * 60 * 1000);
  if (!lockOwner) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }

  const log: string[] = [];
  const start = Date.now();

  try {
    const NIGHTLY_SEARCHES = await buildNightlySearches();
    log.push(`Search matrix: ${NIGHTLY_SEARCHES.length} occupations (core + candidates)`);

    // Step 1: Ingest from ALL available sources (Bundesagentur, Adzuna,
    // Arbeitnow, Jooble, Careerjet — whichever have keys), not just one.
    const sources = availableSources();
    log.push(`Sources: ${sources.map((s) => s.id).join(", ")}`);
    for (const search of NIGHTLY_SEARCHES) {
      for (const src of sources) {
        try {
          const r = await src.ingest({ beruf: search.beruf, region: search.region, maxPages: 2 });
          if (r.vacanciesNew > 0 || r.employersNew > 0) {
            log.push(`${src.id} ${search.beruf}: +${r.vacanciesNew} vac, +${r.employersNew} emp`);
          }
        } catch (err) {
          log.push(`${src.id} ${search.beruf} FAILED: ${(err as Error).message}`);
        }
      }
    }

    // Step 2: Enrich new employers
    const enrichResult = await enrichPendingEmployers(30);
    log.push(`Enrichment: ${enrichResult.enriched} enriched, ${enrichResult.skipped} skipped`);

    // Step 3: Re-score all
    for (const search of NIGHTLY_SEARCHES) {
      const scored = await scoreEmployersForSearch(search.beruf, search.region);
      log.push(`Scored ${scored} employers for ${search.beruf}/${search.region}`);
    }

    // Step 4: Match all active candidates
    const candidates = await prisma.candidate.findMany({ select: { id: true, name: true } });
    for (const candidate of candidates) {
      try {
        const m = await matchCandidateToVacancies(candidate.id);
        log.push(`Match ${candidate.name}: ${m.matched} new matches`);
      } catch (err) {
        log.push(`Match ${candidate.name} FAILED: ${(err as Error).message}`);
      }
    }

    // Step 4b: Auto-pilot — send applications for the newly matched jobs
    // (per-candidate + global daily caps, cooldown, opt-out all enforced).
    try {
      const a = await runAutoSend();
      log.push(
        a.disabled
          ? "Auto-send: disabled (AUTO_SEND_ENABLED=false)"
          : `Auto-send: ${a.sent} sent across ${a.candidates} candidates (${a.skipped} skipped)${a.capReached ? " — global cap reached" : ""}`
      );
    } catch (err) {
      log.push(`Auto-send FAILED: ${(err as Error).message}`);
    }

    // Step 5: Delete dead/expired vacancies via the shared cleanup service —
    // staleness comes from lastSeenAt/postedAt (NOT foundAt: a listing we found
    // 30+ days ago that the source still re-lists is live and must be kept).
    // Dispatched outreach (incl. REPLIED) is protected inside the service.
    try {
      const ex = await deleteExpiredVacancies();
      log.push(`Cleanup: deleted ${ex.expiredDeleted} expired vacancies`);
    } catch (err) {
      log.push(`Cleanup FAILED: ${(err as Error).message}`);
    }

    // Step 5b: Purge any part-time / mini-job listings — full-time only.
    try {
      const pt = await deletePartTimeVacancies();
      log.push(`Part-time purge: deleted ${pt.partTimeDeleted}`);
    } catch (err) {
      log.push(`Part-time purge FAILED: ${(err as Error).message}`);
    }

    // Step 5b-2: Purge any non-German listings — Germany only.
    try {
      const ng = await deleteNonGermanVacancies();
      log.push(`Non-German purge: deleted ${ng.nonGermanDeleted}`);
    } catch (err) {
      log.push(`Non-German purge FAILED: ${(err as Error).message}`);
    }

    // Step 5c: Merge duplicate employers from multiple sources.
    try {
      const dd = await mergeDuplicateEmployers();
      log.push(`Dedup: merged ${dd.merged} across ${dd.groups} groups`);
    } catch (err) {
      log.push(`Dedup FAILED: ${(err as Error).message}`);
    }

    // Step 6: Detect employer replies (IMAP) BEFORE follow-ups, so we never
    // chase someone who already answered.
    try {
      const r = await pollReplies();
      log.push(`Replies: ${r.matched} matched / ${r.scanned} scanned${r.errors.length ? ` (${r.errors.join("; ")})` : ""}`);
      // Auto-heal code-matched mis-attributions (unique [MZ-…] code only).
      if (process.env.REPLY_AUTO_RECONCILE !== "false") {
        const rec = await reconcileReplies(true, true).catch(() => null);
        if (rec) log.push(`Reconcile (code): ${rec.reassigned} moved, ${rec.deduped} deduped`);
      }
    } catch (err) {
      log.push(`Replies FAILED: ${(err as Error).message}`);
    }

    // Step 7: Send follow-ups for unanswered applications past the wait window.
    try {
      const f = await runFollowUps();
      log.push(`Follow-ups: ${f.sent} sent / ${f.eligible} eligible${f.errors.length ? ` (${f.errors.join("; ")})` : ""}`);
    } catch (err) {
      log.push(`Follow-ups FAILED: ${(err as Error).message}`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, log });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, log }, { status: 500 });
  } finally {
    await releaseCronLock("nightly", lockOwner);
  }
}
