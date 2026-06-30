/**
 * Nightly cron — POST /api/cron/nightly
 * Secured with CRON_SECRET header.
 * Sequence: ingest → enrich → score → match all active candidates
 */

import { NextRequest, NextResponse } from "next/server";
import { ingestJobs } from "@/services/arbeitsagentur";
import { enrichPendingEmployers } from "@/services/enrichment";
import { scoreEmployersForSearch, matchCandidateToVacancies } from "@/services/scoring";
import { prisma } from "@/lib/prisma";

const NIGHTLY_SEARCHES: { beruf: string; region: string }[] = [
  { beruf: "Housekeeping", region: "NRW" },
  { beruf: "Koch", region: "NRW" },
  { beruf: "Service", region: "NRW" },
  { beruf: "Rezeption", region: "NRW" },
  { beruf: "Housekeeping", region: "Bayern" },
  { beruf: "Koch", region: "Bayern" },
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  const start = Date.now();

  try {
    // Step 1: Ingest from Arbeitsagentur
    for (const search of NIGHTLY_SEARCHES) {
      try {
        const r = await ingestJobs({ beruf: search.beruf, region: search.region, maxPages: 3 });
        log.push(`Ingest ${search.beruf}/${search.region}: +${r.vacanciesNew} vac, +${r.employersNew} emp`);
      } catch (err) {
        log.push(`Ingest ${search.beruf}/${search.region} FAILED: ${(err as Error).message}`);
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

    // Step 5: Delete stale vacancies (30+ days old). Keep any tied to a SENT
    // outreach so already-contacted employers stay in the history.
    try {
      const EXPIRY_DAYS = 30;
      const expiryCutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const stale = await prisma.vacancy.findMany({
        where: {
          foundAt: { lt: expiryCutoff },
          matches: { none: { outreach: { some: { status: "SENT" } } } },
        },
        select: { id: true, matches: { select: { id: true } } },
      });
      const staleVacancyIds = stale.map((v) => v.id);
      const staleMatchIds = stale.flatMap((v) => v.matches.map((m) => m.id));
      if (staleVacancyIds.length > 0) {
        await prisma.outreach.deleteMany({ where: { matchId: { in: staleMatchIds } } });
        await prisma.match.deleteMany({ where: { id: { in: staleMatchIds } } });
        const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: staleVacancyIds } } });
        log.push(`Cleanup: deleted ${count} expired vacancies`);
      } else {
        log.push("Cleanup: no expired vacancies");
      }
    } catch (err) {
      log.push(`Cleanup FAILED: ${(err as Error).message}`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, log });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, log }, { status: 500 });
  }
}
