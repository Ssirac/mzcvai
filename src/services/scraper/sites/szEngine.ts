/**
 * "Stellenanzeigen" styled-components engine — shared adapter factory.
 *
 * Stellenanzeigen.de and Yourfirm.de run on the same React/styled-components
 * platform: identical `sc-110f8157-*` card markup, the same `data-testid` hooks
 * (`company-name`, `enhanced-link`), the same "Ref-Nr: …" + dd.mm.yyyy layout, and
 * the same `?fulltext=` keyword search. So both are one call to this factory with
 * their own base URL + search path.
 *
 * The build-hashed CSS classes are volatile and NOT used; we anchor on the stable
 * data-testid hooks + document order. Location sits immediately before the
 * employment-type leaf on both sites (before the company on Yourfirm, after it on
 * Stellenanzeigen) — so "the leaf before the type" locates it on both.
 *
 * The unique id is the last path segment of the /job/… link (a stable slug on
 * Stellenanzeigen, the `yf-#####` ref on Yourfirm). Content is client-rendered, so
 * the runner navigates with networkidle2 + waitForSelector before reading HTML.
 */

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const TYPE = /^(Vollzeit|Teilzeit|Minijob|Aushilfe|Werkstudent|Praktikum|Ausbildung|Festanstellung|Zeitarbeit)$/i;
const TYPE_ANY = /(Vollzeit|Teilzeit|Minijob|Aushilfe|Werkstudent|Praktikum|Ausbildung|Festanstellung|Zeitarbeit)/i;

export interface SzConfig {
  id: string;
  label: string;
  category: "hospitality" | "general";
  base: string;         // e.g. "https://www.stellenanzeigen.de"
  searchPath: string;   // e.g. "/suche/" or "/stellenangebote/"
  minDelayMs?: number;
}

export function makeSzAdapter(cfg: SzConfig): ScraperAdapter {
  const base = cfg.base.replace(/\/+$/, "");

  return {
    id: cfg.id,
    label: cfg.label,
    category: cfg.category,
    minDelayMs: cfg.minDelayMs ?? 2000,
    deadMarkers: ["nicht mehr verfügbar", "nicht mehr online", "stellenangebot wurde", "existiert nicht", "seite nicht gefunden"],
    waitForSelector: '[data-testid="company-name"]',

    robotsAllowed: () => robotsAllows(base, cfg.searchPath),

    listUrls({ beruf, maxPages }): string[] {
      const maxTerms = maxPages ?? 4;
      const terms = Array.from(
        new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
      ).slice(0, maxTerms);
      return terms.map((t) => `${base}${cfg.searchPath}?fulltext=${encodeURIComponent(t)}`);
    },

    parse(html: string): RawJob[] {
      const $ = load(html);
      const jobs: RawJob[] = [];

      $('[data-testid="company-name"]').each((_, comp) => {
        const $comp = $(comp);
        const $card = $comp
          .parents()
          .filter((__, p) => {
            const $p = $(p);
            return $p.find('a[href*="/job/"]').length > 0 && /\d{2}\.\d{2}\.\d{4}/.test($p.text());
          })
          .first();
        if (!$card.length) return;

        const href = $card.find('a[href*="/job/"]').first().attr("href") ?? null;
        const slug = href ? href.replace(/\/+$/, "").split("/").pop() ?? null : null;
        if (!slug) return;

        const title = clean($card.find('[data-testid="enhanced-link"]').first().text());
        const employer = clean($comp.text());
        const text = $card.text();
        const typeM = text.match(TYPE_ANY);
        const dateM = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);

        // Location = the leaf right before the employment-type leaf (works whether
        // location precedes or follows the company on this layout).
        const leaves = $card.find("span,p").filter((__, e) => $(e).children().length === 0 && !!$(e).text().trim()).toArray();
        const typeIdx = leaves.findIndex((e) => TYPE.test(clean($(e).text())));
        let location: string | null = null;
        for (let j = typeIdx - 1; j >= 0; j--) {
          const t = clean($(leaves[j]).text());
          if (t && t !== employer && t !== title && !/Ref-Nr/i.test(t) && !/\d{2}\.\d{2}\.\d{4}/.test(t) && !/^Neu$/i.test(t) && !/Schnellbewerbung/i.test(t)) {
            location = t;
            break;
          }
        }

        let postedAt: Date | null = null;
        if (dateM) {
          const dt = new Date(parseInt(dateM[3]), parseInt(dateM[2]) - 1, parseInt(dateM[1]));
          postedAt = isNaN(dt.getTime()) ? null : dt;
        }
        const url = href ? (href.startsWith("http") ? href : `${base}${href}`) : null;

        if (!title || !employer) return;
        jobs.push({
          sourceRef: `${cfg.id}:${slug}`,
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
}
