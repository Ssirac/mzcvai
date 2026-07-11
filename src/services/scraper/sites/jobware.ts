/**
 * Jobware.de adapter (Group B — general board, hospitality-filtered).
 *
 * Angular SPA, but the result cards use STABLE semantic classes (the volatile
 * bits are only the Angular `_ngcontent-*` scoping attributes, which we don't
 * rely on):
 *   • card       = a.job          (href /job/{slug}-{id})
 *   • title      = heading (h1–h5) inside the card
 *   • employer   = .company  (fallback: logo img alt)
 *   • location   = .location
 *   • type       = .chip     (Vollzeit / Teilzeit …)
 *   • date       = .date     (dd.mm.yyyy)
 *
 * Search: /jobsuche?jw_jobname={begriff}. As on the YCG sites, each beruf synonym
 * is its own query (≈20 results) instead of replaying the SPA's pagination.
 * robots.txt only disallows /apply, /callback, /api/__status — /jobsuche allowed.
 * Content is CSR, so parseList waits for the first card to render.
 */

import type { Page } from "puppeteer";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const BASE = "https://www.jobware.de";

export const jobwareAdapter: ScraperAdapter = {
  id: "jobware",
  label: "Jobware (Scraping — Fach- & Führungskräfte)",
  category: "general",
  minDelayMs: 2000, // general board — a touch more cautious than the YCG sites
  deadMarkers: ["stellenangebot ist nicht mehr", "nicht mehr verfügbar", "nicht mehr online", "existiert nicht"],

  robotsAllowed: () => robotsAllows(BASE, "/jobsuche"),

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/jobsuche?jw_jobname=${encodeURIComponent(t)}`);
  },

  async parseList(page: Page): Promise<RawJob[]> {
    // Angular renders the list client-side — wait for the first card (non-fatal).
    await page.waitForSelector("a.job", { timeout: 12000 }).catch(() => {});

    const rows = await page.$$eval("a.job", (cards) =>
      cards
        .filter((c) => /-\d{6,}$/.test(c.getAttribute("href") ?? ""))
        .map((c) => {
          const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
          const href = c.getAttribute("href");
          const idm = href ? href.match(/-(\d{6,})$/) : null;
          const heading = c.querySelector("h1,h2,h3,h4,h5");
          const img = c.querySelector<HTMLImageElement>("img");
          return {
            id: idm ? idm[1] : null,
            href,
            title: clean(heading?.textContent),
            employer: clean(c.querySelector(".company")?.textContent) || clean(img?.alt),
            location: clean(c.querySelector(".location")?.textContent) || null,
            employmentType: clean(c.querySelector(".chip")?.textContent) || null,
            dateStr: clean(c.querySelector(".date")?.textContent) || null,
            description: clean(c.textContent) || null,
          };
        })
    );

    return rows.map((r): RawJob => {
      let postedAt: Date | null = null;
      const dm = r.dateStr?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (dm) {
        const dt = new Date(parseInt(dm[3]), parseInt(dm[2]) - 1, parseInt(dm[1]));
        postedAt = isNaN(dt.getTime()) ? null : dt;
      }
      const url = r.href ? (r.href.startsWith("http") ? r.href : `${BASE}${r.href}`) : null;
      return {
        sourceRef: r.id ? `jobware:${r.id}` : `jobware:${url ?? r.title}`,
        title: r.title,
        employer: r.employer,
        location: r.location,
        url,
        description: r.description,
        employmentType: r.employmentType,
        postedAt,
      };
    });
  },
};
