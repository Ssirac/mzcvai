/**
 * Scraper runner — the single place all scraped sites flow through.
 *
 * Responsibilities (so no adapter has to repeat them):
 *   • robots.txt gate            — refuse to run a disallowed adapter
 *   • rate-limited queue         — one site at a time, minDelayMs between requests
 *   • shared headless browser    — one page per run, always closed
 *   • normalization & filtering  — region mapping, Germany-only, full-time-only
 *   • de-duplication             — per-site sourceRef + cross-source contentHash
 *   • dead-listing removal       — prune ads that 404/redirect/expired
 *   • logging                    — one IngestionRun row per site per run
 *
 * The public entry is a JobSource bridge (asJobSource) so scraped sites live in
 * the same registry as the API sources and are picked up by the existing nightly
 * / refresh flows automatically.
 */

import type { Page } from "puppeteer";
import { prisma } from "@/lib/prisma";
import { launchBrowser } from "@/lib/browser";
import type { ApplyChannel } from "@prisma/client";
import { isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";
import type { JobSource } from "@/services/sources/registry";
import type { ScraperAdapter, RawJob, ScrapeResult } from "./types";
import { normalizeRegion } from "./regions";
import { contentHash } from "./hash";
import { pruneDeadVacancies } from "./deadCheck";

const USER_AGENT =
  "MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de; +https://mz-personalvermittlung.de)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-run dead-check budget (env-tunable): how many stale-ish listings to re-verify.
const DEAD_CHECK_LIMIT = parseInt(process.env.SCRAPE_DEADCHECK_LIMIT ?? "15");
const DEAD_CHECK_NOT_SEEN_MINS = parseInt(process.env.SCRAPE_DEADCHECK_NOT_SEEN_MINS ?? "720"); // 12h

/**
 * Run one scraper adapter for a beruf+region. Returns full counts including the
 * dead-listing removals. Everything is wrapped in an IngestionRun log row.
 */
export async function runScraper(adapter: ScraperAdapter, opts: IngestOptions): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    vacanciesNew: 0, vacanciesUpdated: 0, vacanciesDead: 0,
    employersNew: 0, duplicatesSkipped: 0, errors: [],
  };
  const allGermany = opts.region === "Deutschland";

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: adapter.id, status: "running" },
  });

  try {
    if (!(await adapter.robotsAllowed())) {
      throw new Error("robots.txt disallows the paths this scraper uses");
    }

    const urls = await adapter.listUrls({ beruf: opts.beruf, region: opts.region, maxPages: opts.maxPages });
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(USER_AGENT);
      await page.setDefaultTimeout(20000);

      // ── Queue: visit each listing URL in turn, rate-limited ──────────────────
      const raw: RawJob[] = [];
      let first = true;
      for (const url of urls) {
        if (!first) await sleep(adapter.minDelayMs); // rate limit between requests
        first = false;
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          raw.push(...(await adapter.parseList(page)));
        } catch (err) {
          result.errors.push(`${adapter.id} ${url}: ${(err as Error).message}`);
        }
      }

      // ── Normalize → filter → dedup → store ───────────────────────────────────
      for (const job of raw) {
        try {
          if (!job.sourceRef || !job.title || !job.employer) continue;
          if (isNonGermanLocation(job.location ?? "")) continue;            // Germany only
          if (isPartTimeJob(job.title, job.employmentType ? [job.employmentType] : [], job.description ?? "")) continue; // full-time only

          const region = normalizeRegion(job.location);
          if (!allGermany && region !== opts.region && region !== "Deutschland") continue;

          // Same ad already stored under this site's id → just refresh freshness.
          const bySource = await prisma.vacancy.findUnique({ where: { sourceRef: job.sourceRef } });
          if (bySource) {
            await prisma.vacancy.update({ where: { id: bySource.id }, data: { lastSeenAt: new Date() } });
            result.vacanciesUpdated++;
            continue;
          }

          // Cross-source duplicate (same job on another board) → don't store twice.
          const hash = contentHash({ title: job.title, employer: job.employer, location: job.location });
          const byHash = await prisma.vacancy.findFirst({ where: { contentHash: hash, status: "ACTIVE" } });
          if (byHash) {
            await prisma.vacancy.update({ where: { id: byHash.id }, data: { lastSeenAt: new Date() } });
            result.duplicatesSkipped++;
            continue;
          }

          // New employer (by name + region) or reuse existing.
          let employer = await prisma.employer.findFirst({ where: { name: job.employer, region } });
          if (!employer) {
            employer = await prisma.employer.create({ data: { name: job.employer, city: job.location, region } });
            result.employersNew++;
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.title,
              beruf: opts.beruf,
              region,
              source: adapter.id,
              url: job.url,
              description: (job.description ?? "").slice(0, 5000) || null,
              employmentType: job.employmentType,
              sourceRef: job.sourceRef,
              contentHash: hash,
              applyChannel: "FORM" as ApplyChannel,
              applyValue: job.url,
              postedAt: job.postedAt,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`${adapter.id} job ${job.sourceRef}: ${(err as Error).message}`);
        }
      }

      // ── Dead-listing removal (bounded, rate-limited) ─────────────────────────
      try {
        result.vacanciesDead = await pruneDeadVacancies(page, {
          source: adapter.id,
          limit: DEAD_CHECK_LIMIT,
          notSeenMins: DEAD_CHECK_NOT_SEEN_MINS,
          delayMs: adapter.minDelayMs,
          extraMarkers: adapter.deadMarkers,
        });
      } catch (err) {
        result.errors.push(`${adapter.id} dead-check: ${(err as Error).message}`);
      }
    } finally {
      await browser.close();
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        vacanciesNew: result.vacanciesNew,
        vacanciesUpdated: result.vacanciesUpdated,
        vacanciesDead: result.vacanciesDead,
        employersNew: result.employersNew,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: (err as Error).message, finishedAt: new Date() },
    });
    throw err;
  }

  return result;
}

/**
 * Bridge a ScraperAdapter into the JobSource registry interface, so scraped sites
 * sit alongside the API sources and are driven by the same ingest flows. The
 * scraper-only `vacanciesDead` count is folded into the standard IngestResult.
 */
export function asJobSource(adapter: ScraperAdapter): JobSource {
  return {
    id: adapter.id,
    label: adapter.label,
    category: adapter.category,
    available: () => true,
    ingest: async (o): Promise<IngestResult> => {
      const r = await runScraper(adapter, o);
      return {
        vacanciesNew: r.vacanciesNew,
        vacanciesUpdated: r.vacanciesUpdated,
        employersNew: r.employersNew,
        errors: r.errors,
      };
    },
  };
}

// The set of scraper adapters the scrape-cron should drive (see registry).
export type { ScraperAdapter } from "./types";
