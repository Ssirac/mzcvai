/**
 * Absolventa.de adapter (Group B — graduate / Ausbildung / entry-level board).
 *
 * Server-rendered listing at /stellenangebote?text={begriff}. Cards use Tailwind
 * utility classes (no stable semantic hooks), so we anchor on the job link and
 * read: heading = title, logo img `alt` (minus " Logo") = employer, the
 * "Standort …" text = location, the leading digits of the /stellenangebote/{id}
 * link = the unique id. Parsed with cheerio in Node (bundler-safe).
 */

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const BASE = "https://www.absolventa.de";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export const absolventaAdapter: ScraperAdapter = {
  id: "absolventa",
  label: "Absolventa (Scraping — Ausbildung/Einstieg)",
  category: "general",
  minDelayMs: 2000,
  deadMarkers: ["nicht mehr verfügbar", "nicht mehr aktuell", "existiert nicht", "404"],

  robotsAllowed: () => robotsAllows(BASE, "/stellenangebote"),

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/stellenangebote?text=${encodeURIComponent(t)}`);
  },

  parse(html: string): RawJob[] {
    const $ = load(html);
    const jobs: RawJob[] = [];
    const seen = new Set<string>();

    $('a[href*="/stellenangebote/"]').each((_, a) => {
      const href = $(a).attr("href") || "";
      const idm = href.match(/\/stellenangebote\/(\d+)/);
      if (!idm || seen.has(idm[1])) return;

      // Card = nearest ancestor that carries the "Standort …" line.
      let $card = $(a);
      for (let i = 0; i < 7; i++) {
        const p = $card.parent();
        if (!p.length) break;
        $card = p;
        if (/Standort/i.test($card.text())) break;
      }

      const title = clean($card.find("h1,h2,h3,h4,h5").first().text()) || clean($(a).text());
      const alt = $card.find("img[alt]").first().attr("alt") || "";
      const employer = clean(alt.replace(/\s*Logo\s*$/i, "")) || null;
      const locm = $card.text().match(/Standort\s+(.+?)(?:\s+Job\s+merken|\s+Job\s+melden|$)/i);
      const location = locm ? clean(locm[1]) : null;

      if (!title || !employer) return;
      seen.add(idm[1]);
      jobs.push({
        sourceRef: `absolventa:${idm[1]}`,
        title,
        employer,
        location,
        url: href.startsWith("http") ? href : `${BASE}${href}`,
        description: [title, employer, location].filter(Boolean).join(" · ") || null,
        employmentType: null,
        postedAt: null,
      });
    });

    return jobs;
  },
};
