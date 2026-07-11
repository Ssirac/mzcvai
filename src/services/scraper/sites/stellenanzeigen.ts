/**
 * Stellenanzeigen.de adapter (Group B — general board, hospitality-filtered).
 *
 * React/styled-components SPA. The visual CSS classes are build-hashed (volatile)
 * so we DON'T use them; instead we anchor on the stable `data-testid` hooks and
 * document order:
 *   • card unit  = each [data-testid="company-name"] identifies one job card
 *   • title      = [data-testid="enhanced-link"] within the card
 *   • employer   = [data-testid="company-name"]
 *   • href/id    = the card's a[href^="/job/"] — the last URL segment is a stable
 *                  unique slug (…-sde-108828 / …-yf-47534 / …-reg28976385)
 *   • location   = first leaf after the company element that isn't type/date/ref
 *   • type/date  = matched from the card text
 *
 * Search: /suche/?fulltext={begriff}; each beruf synonym is its own query
 * (≈25 results) instead of replaying pagination. robots.txt allows /suche/ and
 * /job/ (only /api, /ajax, /job/drucken, /bewerbung … are disallowed). Content is
 * CSR, so parseList waits for the first card.
 */

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const BASE = "https://www.stellenanzeigen.de";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const TYPE = /(Vollzeit|Teilzeit|Minijob|Aushilfe|Werkstudent|Praktikum|Ausbildung|Festanstellung|Zeitarbeit)/i;

export const stellenanzeigenAdapter: ScraperAdapter = {
  id: "stellenanzeigen",
  label: "Stellenanzeigen.de (Scraping — allgemein)",
  category: "general",
  minDelayMs: 2000,
  deadMarkers: ["nicht mehr verfügbar", "nicht mehr online", "stellenangebot wurde", "existiert nicht", "seite nicht gefunden"],

  robotsAllowed: () => robotsAllows(BASE, "/suche/"),
  waitForSelector: '[data-testid="company-name"]', // React renders the list client-side

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/suche/?fulltext=${encodeURIComponent(t)}`);
  },

  parse(html: string): RawJob[] {
    const $ = load(html);
    const jobs: RawJob[] = [];

    $('[data-testid="company-name"]').each((_, comp) => {
      const $comp = $(comp);
      // Climb to the card: nearest ancestor with a /job/ link AND a date.
      const $card = $comp
        .parents()
        .filter((__, p) => {
          const $p = $(p);
          return $p.find('a[href^="/job/"]').length > 0 && /\d{2}\.\d{2}\.\d{4}/.test($p.text());
        })
        .first();
      if (!$card.length) return;

      const href = $card.find('a[href^="/job/"]').first().attr("href") ?? null;
      const slug = href ? href.replace(/\/+$/, "").split("/").pop() ?? null : null;
      if (!slug) return;

      const title = clean($card.find('[data-testid="enhanced-link"]').first().text());
      const employer = clean($comp.text());
      const text = $card.text();
      const typeM = text.match(TYPE);
      const dateM = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);

      // location = first leaf span/p after the company element that isn't the
      // employment type, a benefit chip, the Ref-Nr or the date.
      const leaves = $card.find("span,p").filter((__, e) => $(e).children().length === 0 && !!$(e).text().trim()).toArray();
      const ci = leaves.findIndex((e) => $(e).attr("data-testid") === "company-name");
      let location: string | null = null;
      for (let j = ci + 1; j < leaves.length; j++) {
        const t = clean($(leaves[j]).text());
        if (t && !TYPE.test(t) && !/Ref-Nr/i.test(t) && !/\d{2}\.\d{2}\.\d{4}/.test(t) && !/Schnellbewerbung/i.test(t)) {
          location = t;
          break;
        }
      }

      let postedAt: Date | null = null;
      if (dateM) {
        const dt = new Date(parseInt(dateM[3]), parseInt(dateM[2]) - 1, parseInt(dateM[1]));
        postedAt = isNaN(dt.getTime()) ? null : dt;
      }
      const url = href ? (href.startsWith("http") ? href : `${BASE}${href}`) : null;

      if (!title || !employer) return;
      jobs.push({
        sourceRef: `stellenanzeigen:${slug}`,
        title,
        employer,
        location,
        url,
        description: [title, employer, location, typeM ? typeM[1] : null].filter(Boolean).join(" · ") || null,
        employmentType: typeM ? typeM[1] : null,
        postedAt,
      });
    });

    return jobs;
  },
};
