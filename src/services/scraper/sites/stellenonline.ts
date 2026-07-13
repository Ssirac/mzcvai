/**
 * Stellenonline.de adapter (Group B — general board, ~2.7k jobs/keyword).
 *
 * Django app; the /search?q={begriff} result list is client-rendered, with stable
 * class hooks on each `.search-results__item`:
 *   • title    = heading (h1–h5)
 *   • employer = .employer
 *   • location = .js-location-name
 *   • type     = .search-results__item-chip
 * There is NO per-job URL on the card (a JS panel opens the detail), so the id is
 * a content hash of title+employer+location. That's fine for our email-outreach
 * model, which needs the employer (→ generic email) rather than the job link.
 * Parsed with cheerio in Node; runner waits for the first card (CSR).
 */

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";
import { contentHash } from "../hash";

const BASE = "https://www.stellenonline.de";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export const stellenonlineAdapter: ScraperAdapter = {
  id: "stellenonline",
  label: "Stellenonline.de (Scraping — allgemein)",
  category: "general",
  minDelayMs: 2000,
  deadMarkers: ["nicht mehr verfügbar", "nicht mehr aktuell", "existiert nicht", "seite nicht gefunden"],
  waitForSelector: ".search-results__item",

  robotsAllowed: () => robotsAllows(BASE, "/search"),

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/search?q=${encodeURIComponent(t)}`);
  },

  parse(html: string): RawJob[] {
    const $ = load(html);
    const jobs: RawJob[] = [];
    const seen = new Set<string>();

    $(".search-results__item").each((_, el) => {
      const $el = $(el);
      const title = clean($el.find("h1,h2,h3,h4,h5").first().text());
      const employer = clean($el.find(".employer").first().text()) || null;
      const location = clean($el.find(".js-location-name").first().text()) || null;
      const employmentType = clean($el.find(".search-results__item-chip").first().text()) || null;
      if (!title || !employer) return;

      // No URL/id on the card → stable id from the posting's essence.
      const key = contentHash({ title, employer, location }).slice(0, 20);
      if (seen.has(key)) return;
      seen.add(key);

      jobs.push({
        sourceRef: `stellenonline:${key}`,
        title,
        employer,
        location,
        url: null,
        description: [title, employer, location, employmentType].filter(Boolean).join(" · ") || null,
        employmentType,
        postedAt: null,
      });
    });

    return jobs;
  },
};
