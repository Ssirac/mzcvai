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

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const BASE = "https://www.jobware.de";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export const jobwareAdapter: ScraperAdapter = {
  id: "jobware",
  label: "Jobware (Scraping — Fach- & Führungskräfte)",
  category: "general",
  minDelayMs: 2000, // general board — a touch more cautious than the YCG sites
  deadMarkers: ["stellenangebot ist nicht mehr", "nicht mehr verfügbar", "nicht mehr online", "existiert nicht"],

  robotsAllowed: () => robotsAllows(BASE, "/jobsuche"),
  waitForSelector: "a.job", // Angular renders the list client-side

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/jobsuche?jw_jobname=${encodeURIComponent(t)}`);
  },

  parse(html: string): RawJob[] {
    const $ = load(html);
    const jobs: RawJob[] = [];

    $("a.job").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") ?? "";
      const idm = href.match(/-(\d{6,})$/);
      if (!idm) return; // skip non-job anchors

      const title = clean($el.find("h1,h2,h3,h4,h5").first().text());
      const employer = clean($el.find(".company").first().text()) || clean($el.find("img").first().attr("alt"));
      const location = clean($el.find(".location").first().text()) || null;
      const employmentType = clean($el.find(".chip").first().text()) || null;
      const dateStr = clean($el.find(".date").first().text());

      let postedAt: Date | null = null;
      const dm = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (dm) {
        const dt = new Date(parseInt(dm[3]), parseInt(dm[2]) - 1, parseInt(dm[1]));
        postedAt = isNaN(dt.getTime()) ? null : dt;
      }
      const url = href.startsWith("http") ? href : `${BASE}${href}`;

      if (!title || !employer) return;
      jobs.push({
        sourceRef: `jobware:${idm[1]}`,
        title,
        employer,
        location,
        url,
        description: clean($el.text()) || null,
        employmentType,
        postedAt,
      });
    });

    return jobs;
  },
};
