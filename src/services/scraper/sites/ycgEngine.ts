/**
 * YourCareerGroup (YCG) engine — shared adapter factory.
 *
 * Several DACH hospitality boards run on the exact same YourCareerGroup platform
 * and are byte-for-byte identical in structure: Hotelcareer, Gastrojobs and
 * YourCareerGroup itself. They share the `article.ycg-job-item` markup, the
 * `/jobs/{suchbegriff}` listing URLs, and even the same underlying job IDs (the
 * same posting appears on all of them — which the runner's contentHash dedup
 * collapses into one row). So instead of copy-pasting a scraper per site, each is
 * a one-line call to this factory with its own base URL + id.
 *
 * robots.txt on every YCG site only disallows /advent/ for the generic
 * user-agent; the /jobs path is allowed.
 *
 * Structure verified live on hotelcareer.de and gastrojobs.de. Deep pagination is
 * a session-bound AJAX POST (fragile) and is deliberately NOT replayed; instead
 * each beruf synonym is its own clean first-page URL.
 */

import type { Page } from "puppeteer";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

export interface YcgConfig {
  id: string;
  label: string;
  base: string; // e.g. "https://www.gastrojobs.de" (no trailing slash)
  minDelayMs?: number;
}

// beruf/synonym → YCG search slug.
function toSlug(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/[\s/]+/g, "-")
    .replace(/[^a-z0-9äöüß\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function makeYcgAdapter(cfg: YcgConfig): ScraperAdapter {
  const base = cfg.base.replace(/\/+$/, "");

  return {
    id: cfg.id,
    label: cfg.label,
    category: "hospitality",
    minDelayMs: cfg.minDelayMs ?? 1500,
    deadMarkers: ["nicht mehr verfügbar", "stelle ist leider", "job nicht mehr"],

    robotsAllowed: () => robotsAllows(base, "/jobs/"),

    listUrls({ beruf, maxPages }): string[] {
      const maxTerms = maxPages ?? 4;
      const slugs = Array.from(
        new Set([beruf, ...berufSearchKeywords(beruf)].map(toSlug).filter((s) => s.length >= 3))
      ).slice(0, maxTerms);
      return slugs.map((s) => `${base}/jobs/${s}`);
    },

    async parseList(page: Page): Promise<RawJob[]> {
      // $$eval runs in the browser and returns JSON-serializable data only, so it
      // yields plain strings; the Date is built here in Node afterwards.
      const rows = await page.$$eval("article.ycg-job-item", (arts, siteBase) =>
        arts.map((a) => {
          const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
          const h2 = a.querySelector("h2");
          const titleA = a.querySelector<HTMLAnchorElement>("a.link-blue-none");
          const em = a.querySelector(".w-75 > em") ?? a.querySelector("em");
          const spans = Array.from(a.querySelectorAll(".ycg-job-metadata span"));
          const byIcon = (cls: string) => {
            const s = spans.find((sp) => sp.querySelector("i." + cls));
            return s ? clean(s.textContent) : null;
          };
          const href = titleA ? titleA.getAttribute("href") : null;
          const idm = href ? href.match(/-(\d+)(?:\?|$)/) : null;
          const datem = clean(a.textContent).match(/\b\d{2}\.\d{2}\.\d{4}\b/);
          const abs = href ? (href.startsWith("http") ? href : `${siteBase}${href}`) : null;
          return {
            id: idm ? idm[1] : null,
            title: h2 ? clean(h2.textContent) : "",
            employer: em ? clean(em.textContent) : "",
            location: byIcon("ycg-i-location"),
            url: abs,
            description: clean(a.textContent) || null,
            employmentType: byIcon("ycg-i-info"),
            dateStr: datem ? datem[0] : null,
          };
        }), base
      );

      return rows.map((r): RawJob => {
        let postedAt: Date | null = null;
        if (r.dateStr) {
          const [d, m, y] = r.dateStr.split(".").map((n) => parseInt(n, 10));
          const dt = new Date(y, m - 1, d);
          postedAt = isNaN(dt.getTime()) ? null : dt;
        }
        return {
          sourceRef: r.id ? `${cfg.id}:${r.id}` : `${cfg.id}:${r.url ?? r.title}`,
          title: r.title,
          employer: r.employer,
          location: r.location,
          url: r.url,
          description: r.description,
          employmentType: r.employmentType,
          postedAt,
        };
      });
    },
  };
}
