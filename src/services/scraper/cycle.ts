/**
 * Scrape cycle — the scheduled entry point that drives ALL scraper adapters.
 *
 * Queueing discipline: adapters run strictly one-at-a-time (never hammer several
 * sites at once), and within an adapter the runner keeps that site's own delay.
 * After new listings land, active candidates are re-matched so fresh jobs surface
 * in the app immediately.
 *
 * Cadence is configurable via SCRAPE_INTERVAL_HOURS (see instrumentation.ts),
 * default ~3×/day.
 */

import { prisma } from "@/lib/prisma";
import { runScraper } from "./runner";
import { SCRAPER_ADAPTERS } from "./sites";
import { matchCandidateToVacancies } from "@/services/scoring";
import { candidateProfiles } from "@/lib/candidateProfiles";

export interface ScrapeCycleResult {
  adapters: number;
  berufe: number;
  vacanciesNew: number;
  vacanciesUpdated: number;
  vacanciesDead: number;
  duplicatesSkipped: number;
  matched: number;
  perSite: Record<string, { new: number; dead: number; dup: number; errors: number }>;
}

// Occupations to scrape = what ACTIVE/PENDING candidates actually need —
// desired position, beruf, AND the CV's experience titles (full-CV matching).
async function scrapeBerufe(): Promise<string[]> {
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { beruf: true, desiredPosition: true, experience: true },
  });
  const set = new Set<string>();
  for (const c of candidates) {
    for (const p of candidateProfiles(c)) set.add(p);
  }
  return Array.from(set).slice(0, 20); // cap so a cycle stays within maxDuration
}

// In-flight guard: with an hourly (or faster) schedule a long cycle could still
// be running when the next tick fires. Skip the overlapping run rather than
// double-scraping every board.
let running = false;

export async function runScrapeCycle(maxPagesPerSearch = 3): Promise<ScrapeCycleResult> {
  if (running) {
    return {
      adapters: SCRAPER_ADAPTERS.length, berufe: 0,
      vacanciesNew: 0, vacanciesUpdated: 0, vacanciesDead: 0, duplicatesSkipped: 0,
      matched: 0, perSite: { _skipped: { new: 0, dead: 0, dup: 0, errors: 0 } },
    };
  }
  running = true;
  try {
    return await runScrapeCycleInner(maxPagesPerSearch);
  } finally {
    running = false;
  }
}

async function runScrapeCycleInner(maxPagesPerSearch: number): Promise<ScrapeCycleResult> {
  const berufe = await scrapeBerufe();
  const result: ScrapeCycleResult = {
    adapters: SCRAPER_ADAPTERS.length, berufe: berufe.length,
    vacanciesNew: 0, vacanciesUpdated: 0, vacanciesDead: 0, duplicatesSkipped: 0,
    matched: 0, perSite: {},
  };

  // One site at a time (queue), one beruf at a time — the runner rate-limits within.
  for (const adapter of SCRAPER_ADAPTERS) {
    const site = { new: 0, dead: 0, dup: 0, errors: 0 };
    for (const beruf of berufe) {
      try {
        const r = await runScraper(adapter, { beruf, region: "Deutschland", maxPages: maxPagesPerSearch });
        result.vacanciesNew += r.vacanciesNew;
        result.vacanciesUpdated += r.vacanciesUpdated;
        result.vacanciesDead += r.vacanciesDead;
        result.duplicatesSkipped += r.duplicatesSkipped;
        site.new += r.vacanciesNew; site.dead += r.vacanciesDead; site.dup += r.duplicatesSkipped; site.errors += r.errors.length;
      } catch {
        site.errors++; // one bad site/search must not stop the cycle
      }
    }
    result.perSite[adapter.id] = site;
  }

  // ALWAYS re-match — a cycle with zero brand-new listings still refreshes
  // lastSeenAt on re-listed jobs (making them "fresh" again for the match
  // filter), and other ingest paths may have added inventory in the meantime.
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { id: true },
  });
  for (const c of candidates) {
    try {
      const m = await matchCandidateToVacancies(c.id);
      result.matched += m.matched;
    } catch { /* keep going */ }
  }

  return result;
}
