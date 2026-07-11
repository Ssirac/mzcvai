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

// Occupations to scrape = what ACTIVE/PENDING candidates actually need.
async function scrapeBerufe(): Promise<string[]> {
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { beruf: true, desiredPosition: true },
  });
  const set = new Set<string>();
  for (const c of candidates) {
    for (const raw of [c.desiredPosition, c.beruf]) {
      const b = raw?.trim();
      if (b && b.length >= 3) set.add(b);
    }
  }
  return Array.from(set).slice(0, 15); // cap so a cycle stays within maxDuration
}

export async function runScrapeCycle(maxPagesPerSearch = 3): Promise<ScrapeCycleResult> {
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

  // Re-match so the newly scraped jobs appear for candidates right away.
  if (result.vacanciesNew > 0) {
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
  }

  return result;
}
