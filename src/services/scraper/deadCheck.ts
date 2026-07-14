/**
 * Dead-listing detection & removal for scraped vacancies.
 *
 * A scraped job disappears when the position is filled or the ad is pulled. Two
 * mechanisms keep the DB clean:
 *   1. Re-listing refreshes lastSeenAt (done in the runner) — anything a source
 *      stops echoing goes stale and is removed by the normal cleanup service.
 *   2. This ACTIVE check re-visits a bounded batch of a source's own listing URLs
 *      each run and deletes the ones that now 404 / redirect away / show a
 *      "nicht mehr verfügbar" marker — catching dead ads BEFORE they go stale.
 *
 * FK-safe (Outreach → Match → Vacancy) and history-safe: vacancies tied to a
 * SENT outreach are never deleted.
 */

import type { Page } from "puppeteer";
import { prisma } from "@/lib/prisma";
import { launchBrowser } from "@/lib/browser";

const GENERIC_DEAD_MARKERS = [
  // German
  "nicht mehr verfügbar", "nicht mehr verfuegbar", "nicht mehr online",
  "nicht mehr aktuell", "anzeige wurde deaktiviert", "stelle ist besetzt",
  "stelle ist bereits besetzt", "position wurde besetzt", "wurde geschlossen",
  "nicht mehr aktiv", "abgelaufen", "nicht gefunden", "seite nicht gefunden",
  "existiert nicht", "stellenanzeige ist abgelaufen", "leider nicht mehr",
  "job ist leider nicht mehr", "stelle ist nicht mehr",
  // English
  "position filled", "position has been filled", "job is no longer",
  "no longer available", "no longer valid", "no longer active",
  "this job has expired", "job has been filled", "expired", "not found",
  // Turkish (some source sites localise the expiry notice)
  "artık geçerli değil", "geçerli değil", "yayında değil",
  "ilan yayından kaldırıldı", "bu ilan sona erdi", "ilan süresi doldu",
];

// Decide whether a single listing URL is dead. Navigates the shared page and
// inspects HTTP status, final URL (redirect to home/search = gone) and body text.
export async function isListingDead(page: Page, url: string, extraMarkers: string[] = []): Promise<boolean> {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const status = res?.status() ?? 0;
    if (status >= 400) return true; // 404/410/5xx → gone

    // Redirected to the site root or a search/overview page ⇒ the ad itself is gone.
    const finalUrl = page.url();
    try {
      const orig = new URL(url);
      const fin = new URL(finalUrl);
      const strippedFinal = fin.pathname.replace(/\/+$/, "");
      if (fin.origin === orig.origin && (strippedFinal === "" || /\/(suche|search|jobs)\/?$/.test(fin.pathname)) && fin.pathname !== orig.pathname) {
        return true;
      }
    } catch { /* ignore URL parse issues */ }

    // Read the rendered HTML (not page.evaluate — a serialized closure would hit
    // the same bundler `__name` issue as $$eval). Markers are plain text, so a
    // substring check against the lowercased HTML is sufficient.
    const body = (await page.content()).toLowerCase();
    const markers = [...GENERIC_DEAD_MARKERS, ...extraMarkers.map((m) => m.toLowerCase())];
    return markers.some((m) => body.includes(m));
  } catch {
    // A navigation error (DNS/timeout) is inconclusive — do NOT delete on our own
    // network trouble; leave it for the stale-based cleanup instead.
    return false;
  }
}

/**
 * Retire a set of dead vacancy ids:
 *  - vacancies with NO sent application are hard-deleted (FK-safe);
 *  - vacancies tied to a SENT outreach are soft-expired (status → EXPIRED) so
 *    they drop out of candidates' matches while the application history is kept.
 * Previously the sent-tied ones were skipped entirely, so an applied job that
 * later went dead ("nicht mehr aktuell") stayed ACTIVE and kept showing.
 */
async function retireDeadVacancies(ids: string[]): Promise<{ deleted: number; expired: number }> {
  if (ids.length === 0) return { deleted: 0, expired: 0 };
  const rows = await prisma.vacancy.findMany({
    where: { id: { in: ids } },
    select: { id: true, matches: { select: { id: true, outreach: { select: { status: true } } } } },
  });

  const deletableVacIds: string[] = [];
  const deletableMatchIds: string[] = [];
  const expireVacIds: string[] = [];
  for (const v of rows) {
    const hasSent = v.matches.some((m) => m.outreach.some((o) => o.status === "SENT"));
    if (hasSent) {
      expireVacIds.push(v.id);
    } else {
      deletableVacIds.push(v.id);
      deletableMatchIds.push(...v.matches.map((m) => m.id));
    }
  }

  let deleted = 0;
  let expired = 0;
  if (deletableVacIds.length) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: deletableMatchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: deletableMatchIds } } });
    ({ count: deleted } = await prisma.vacancy.deleteMany({ where: { id: { in: deletableVacIds } } }));
  }
  if (expireVacIds.length) {
    ({ count: expired } = await prisma.vacancy.updateMany({ where: { id: { in: expireVacIds } }, data: { status: "EXPIRED" } }));
  }
  return { deleted, expired };
}

/**
 * Re-check a bounded batch of one source's ACTIVE vacancies and delete the dead
 * ones. Only rows NOT refreshed in this run (lastSeenAt older than `notSeenMins`)
 * are candidates, so we never re-fetch a URL the scrape just confirmed. Capped by
 * `limit` to keep the request budget (and rate-limit) sane.
 */
export async function pruneDeadVacancies(
  page: Page,
  opts: { source: string; limit: number; notSeenMins: number; delayMs: number; extraMarkers?: string[] }
): Promise<number> {
  const cutoff = new Date(Date.now() - opts.notSeenMins * 60 * 1000);
  const candidates = await prisma.vacancy.findMany({
    where: {
      source: opts.source,
      status: "ACTIVE",
      url: { not: null },
      lastSeenAt: { lt: cutoff },
    },
    orderBy: { lastSeenAt: "asc" }, // oldest-unseen first — most likely dead
    take: opts.limit,
    select: { id: true, url: true },
  });

  const deadIds: string[] = [];
  for (const v of candidates) {
    if (!v.url) continue;
    if (await isListingDead(page, v.url, opts.extraMarkers)) deadIds.push(v.id);
    await new Promise((r) => setTimeout(r, opts.delayMs)); // respect the site's rate limit
  }
  const { deleted, expired } = await retireDeadVacancies(deadIds);
  return deleted + expired;
}

/**
 * Cross-source dead sweep. The scraper dead-check (pruneDeadVacancies) only covers
 * scraped sources; API sources (adzuna, arbeitnow, arbeitsagentur…) can still
 * carry an expired posting whose external page now says "no longer valid". This
 * self-contained sweep visits a bounded batch of ACTIVE vacancies of ANY source
 * (oldest-seen first) and removes the dead ones — so expired jobs stop showing up
 * in candidates' matches. Launches + closes its own browser; runs from cron.
 */
export async function sweepDeadVacancies(
  opts?: { limit?: number; notSeenMins?: number; delayMs?: number; maxMs?: number }
): Promise<{ checked: number; deleted: number; expired: number }> {
  const limit = opts?.limit ?? parseInt(process.env.DEAD_SWEEP_LIMIT ?? "30");
  const notSeenMins = opts?.notSeenMins ?? parseInt(process.env.DEAD_SWEEP_NOT_SEEN_MINS ?? "360"); // 6h
  const delayMs = opts?.delayMs ?? 1200;
  const maxMs = opts?.maxMs ?? 0; // 0 = no time budget
  const started = Date.now();
  // notSeenMins <= 0 means "check everything" (manual full sweep), so use a future
  // cutoff that matches all rows.
  const cutoff = notSeenMins <= 0 ? new Date(Date.now() + 60_000) : new Date(Date.now() - notSeenMins * 60 * 1000);

  const candidates = await prisma.vacancy.findMany({
    where: {
      status: "ACTIVE",
      url: { not: null },
      lastSeenAt: { lt: cutoff },
      // Applied-to vacancies are included: retireDeadVacancies soft-expires those
      // (keeping the history) instead of deleting them, so a job that went dead
      // after we applied still drops out of the candidate's matches.
    },
    orderBy: { lastSeenAt: "asc" },
    take: limit,
    select: { id: true, url: true },
  });
  if (candidates.length === 0) return { checked: 0, deleted: 0, expired: 0 };

  const browser = await launchBrowser();
  const deadIds: string[] = [];
  let checked = 0;
  try {
    const page = await browser.newPage();
    await page.setUserAgent("MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de)");
    await page.setDefaultTimeout(20000);
    for (const v of candidates) {
      if (!v.url) continue;
      if (maxMs && Date.now() - started > maxMs) break; // stop within the request budget
      checked++;
      try {
        if (await isListingDead(page, v.url)) deadIds.push(v.id);
      } catch { /* inconclusive — leave for the stale-based cleanup */ }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  } finally {
    await browser.close();
  }
  const { deleted, expired } = await retireDeadVacancies(deadIds);
  return { checked, deleted, expired };
}
