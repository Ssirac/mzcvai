/**
 * Hokify.de adapter (Group B — entry-level / Ausbildung, mobile-first board).
 *
 * Nuxt SPA; the listing at /jobs?q={begriff} renders job cards linking to
 * /job/{id}. No stable semantic classes, so we anchor on the job link and read:
 * heading = title, logo img `alt` = employer, and the card text tail
 * ("{location} {type}vor etwa …") gives location + employment type. Parsed with
 * cheerio in Node. Client-rendered → runner waits for the first job link.
 */

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const BASE = "https://hokify.de";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const TYPE_SPLIT = /\s+(Vollzeit|Teilzeit|Ausbildungsplatz|Lehrstelle|Lehre|Praktikum|Werkstudent|Minijob|Festanstellung|Keine Ausbildung|Ausbildung)/i;
const TYPE_REAL = /(Vollzeit|Teilzeit|Ausbildungsplatz|Lehrstelle|Lehre|Praktikum|Werkstudent|Minijob|Festanstellung)/i;

export const hokifyAdapter: ScraperAdapter = {
  id: "hokify",
  label: "Hokify (Scraping — Einstieg/Ausbildung)",
  category: "general",
  minDelayMs: 2000,
  deadMarkers: ["nicht mehr verfügbar", "nicht mehr aktuell", "job nicht gefunden", "existiert nicht"],
  waitForSelector: 'a[href^="/job/"]',

  robotsAllowed: () => robotsAllows(BASE, "/jobs"),

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/jobs?q=${encodeURIComponent(t)}`);
  },

  parse(html: string): RawJob[] {
    const $ = load(html);
    const jobs: RawJob[] = [];
    const seen = new Set<string>();

    $('a[href^="/job/"]').each((_, a) => {
      const href = $(a).attr("href") || "";
      const idm = href.match(/\/job\/(\d+)/);
      if (!idm || seen.has(idm[1])) return;

      // Card = nearest ancestor carrying both a heading and the logo image.
      let $card = $(a);
      for (let i = 0; i < 6; i++) {
        const p = $card.parent();
        if (!p.length) break;
        $card = p;
        if ($card.find("h1,h2,h3,h4,h5").length && $card.find("img[alt]").length) break;
      }

      const title = clean($card.find("h1,h2,h3,h4,h5").first().text()) || clean($(a).text());
      const employer = clean($card.find("img[alt]").first().attr("alt")) || null;
      if (!title || !employer) return;

      // Tail after title+company, before the "vor etwa …" timestamp → location + type.
      let rest = clean($card.text());
      rest = rest.replace(title, " ").replace(employer, " ");
      rest = clean(rest.split(/\bvor\s+/i)[0]);
      const typeM = rest.match(TYPE_REAL);
      const location = clean(rest.split(TYPE_SPLIT)[0]) || null;

      seen.add(idm[1]);
      jobs.push({
        sourceRef: `hokify:${idm[1]}`,
        title,
        employer,
        location,
        url: href.startsWith("http") ? href : `${BASE}${href}`,
        description: [title, employer, location].filter(Boolean).join(" · ") || null,
        employmentType: typeM ? typeM[1] : null,
        postedAt: null,
      });
    });

    return jobs;
  },
};
