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

import type { Page } from "puppeteer";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const BASE = "https://www.stellenanzeigen.de";

export const stellenanzeigenAdapter: ScraperAdapter = {
  id: "stellenanzeigen",
  label: "Stellenanzeigen.de (Scraping — allgemein)",
  category: "general",
  minDelayMs: 2000,
  deadMarkers: ["nicht mehr verfügbar", "nicht mehr online", "stellenangebot wurde", "existiert nicht", "seite nicht gefunden"],

  robotsAllowed: () => robotsAllows(BASE, "/suche/"),

  listUrls({ beruf, maxPages }): string[] {
    const maxTerms = maxPages ?? 4;
    const terms = Array.from(
      new Set([beruf, ...berufSearchKeywords(beruf)].map((t) => t.trim()).filter((t) => t.length >= 3))
    ).slice(0, maxTerms);
    return terms.map((t) => `${BASE}/suche/?fulltext=${encodeURIComponent(t)}`);
  },

  async parseList(page: Page): Promise<RawJob[]> {
    await page.waitForSelector('[data-testid="company-name"]', { timeout: 12000 }).catch(() => {});

    const rows = await page.$$eval('[data-testid="company-name"]', (comps) => {
      const TYPE = /(Vollzeit|Teilzeit|Minijob|Aushilfe|Werkstudent|Praktikum|Ausbildung|Festanstellung|Zeitarbeit)/i;
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

      return comps.map((comp) => {
        // Climb to the card: nearest ancestor that has a /job/ link AND a date.
        let card: HTMLElement | null = comp as HTMLElement;
        for (let i = 0; i < 9 && card?.parentElement; i++) {
          card = card.parentElement;
          const t = card.textContent ?? "";
          if (/\d{2}\.\d{2}\.\d{4}/.test(t) && card.querySelector('a[href^="/job/"]')) break;
        }
        if (!card) return null;

        const jobA = card.querySelector<HTMLAnchorElement>('a[href^="/job/"]');
        const href = jobA ? jobA.getAttribute("href") : null;
        const slug = href ? href.replace(/\/+$/, "").split("/").pop() ?? null : null;
        const titleEl = card.querySelector('[data-testid="enhanced-link"]');
        const text = card.textContent ?? "";
        const typeM = text.match(TYPE);
        const dateM = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);

        // location = first leaf span/p after the company element that isn't the
        // employment type, a benefit chip artefact, the Ref-Nr or the date.
        const leaves = Array.from(card.querySelectorAll("span,p")).filter(
          (e) => e.children.length === 0 && (e.textContent ?? "").trim()
        );
        const ci = leaves.findIndex((e) => e.getAttribute("data-testid") === "company-name");
        let location: string | null = null;
        for (let j = ci + 1; j < leaves.length; j++) {
          const t = clean(leaves[j].textContent);
          if (t && !TYPE.test(t) && !/Ref-Nr/i.test(t) && !/\d{2}\.\d{2}\.\d{4}/.test(t) && !/Schnellbewerbung/i.test(t)) {
            location = t;
            break;
          }
        }

        return {
          slug,
          href,
          title: clean(titleEl?.textContent),
          employer: clean(comp.textContent),
          location,
          employmentType: typeM ? typeM[1] : null,
          dateStr: dateM ? dateM[0] : null,
        };
      });
    });

    return rows
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.slug)
      .map((r): RawJob => {
        let postedAt: Date | null = null;
        const dm = r.dateStr?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (dm) {
          const dt = new Date(parseInt(dm[3]), parseInt(dm[2]) - 1, parseInt(dm[1]));
          postedAt = isNaN(dt.getTime()) ? null : dt;
        }
        const url = r.href ? (r.href.startsWith("http") ? r.href : `${BASE}${r.href}`) : null;
        return {
          sourceRef: `stellenanzeigen:${r.slug}`,
          title: r.title,
          employer: r.employer,
          location: r.location,
          url,
          description: [r.title, r.employer, r.location, r.employmentType].filter(Boolean).join(" · ") || null,
          employmentType: r.employmentType,
          postedAt,
        };
      });
  },
};
