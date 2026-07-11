/**
 * Shared types for the script-based (scraping) ingestion framework.
 *
 * Every scraped site is a small ScraperAdapter; all the cross-cutting concerns —
 * rate-limiting/queueing, robots.txt, dead-listing removal, content-hash
 * de-duplication and per-run logging — live once in the runner (see runner.ts),
 * NOT in each site. Adding a new site therefore means writing one adapter that
 * only knows two things: which listing URLs to visit, and how to parse a loaded
 * page into raw jobs.
 */

import type { Page } from "puppeteer";

// A single job as scraped from a listing page, BEFORE normalization/filtering.
// The runner fills in the canonical region, applies filters, hashes and stores it.
export interface RawJob {
  /** Stable per-site id, e.g. "hotelcareer:3879822" — used as Vacancy.sourceRef. */
  sourceRef: string;
  title: string;
  employer: string;
  location: string | null;
  url: string | null;
  description: string | null;
  employmentType: string | null;
  postedAt: Date | null;
}

export interface ScraperAdapter {
  /** Registry id, e.g. "hotelcareer". Also stored as Vacancy.source. */
  id: string;
  label: string;
  category: "hospitality" | "general";
  /**
   * Minimum delay (ms) the runner keeps BETWEEN requests to this site — the
   * per-site rate limit. Higher for bot-protected sites (C group).
   */
  minDelayMs: number;
  /** Verify robots.txt permits the paths this adapter uses. Fail-open on error. */
  robotsAllowed(): Promise<boolean>;
  /**
   * The listing-page URLs to visit for one beruf+region search. The runner
   * navigates each in turn (rate-limited) and calls parseList on the result.
   */
  listUrls(opts: { beruf: string; region: string; maxPages?: number }): string[] | Promise<string[]>;
  /** Parse the currently-loaded listing page into raw jobs. */
  parseList(page: Page): Promise<RawJob[]>;
  /**
   * Extra body-text markers (lowercased) that mean "this listing is dead" on
   * this site, e.g. "anzeige ist nicht mehr verfügbar". Checked by the dead-check
   * on top of HTTP status / redirect detection.
   */
  deadMarkers?: string[];
}

// What one runScraper() call reports back — extends the API sources' IngestResult
// shape with the scraper-only dead-listing count.
export interface ScrapeResult {
  vacanciesNew: number;
  vacanciesUpdated: number;
  vacanciesDead: number;
  employersNew: number;
  duplicatesSkipped: number;
  errors: string[];
}
