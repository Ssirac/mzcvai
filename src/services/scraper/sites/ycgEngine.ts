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

import { load } from "cheerio";
import { berufSearchKeywords } from "@/lib/berufMap";
import type { ScraperAdapter, RawJob } from "../types";
import { robotsAllows } from "../robots";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

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

    parse(html: string): RawJob[] {
      const $ = load(html);
      const jobs: RawJob[] = [];

      $("article.ycg-job-item").each((_, el) => {
        const $el = $(el);
        const title = clean($el.find("h2").first().text());
        const href = $el.find("a.link-blue-none").first().attr("href") ?? null;
        const emCard = $el.find(".w-75 > em").first();
        const employer = clean((emCard.length ? emCard : $el.find("em").first()).text());

        // Metadata spans carry an icon that tells us which field they hold.
        let location: string | null = null;
        let employmentType: string | null = null;
        $el.find(".ycg-job-metadata span").each((__, sp) => {
          const $sp = $(sp);
          if ($sp.find("i.ycg-i-location").length) location = clean($sp.text());
          if ($sp.find("i.ycg-i-info").length) employmentType = clean($sp.text());
        });

        const cardText = clean($el.text());
        const datem = cardText.match(/\b\d{2}\.\d{2}\.\d{4}\b/);
        const idm = href ? href.match(/-(\d+)(?:\?|$)/) : null;
        const url = href ? (href.startsWith("http") ? href : `${base}${href}`) : null;

        let postedAt: Date | null = null;
        if (datem) {
          const [d, m, y] = datem[0].split(".").map((n) => parseInt(n, 10));
          const dt = new Date(y, m - 1, d);
          postedAt = isNaN(dt.getTime()) ? null : dt;
        }

        if (!title || !employer) return;
        jobs.push({
          sourceRef: idm ? `${cfg.id}:${idm[1]}` : `${cfg.id}:${url ?? title}`,
          title,
          employer,
          location,
          url,
          description: cardText || null,
          employmentType,
          postedAt,
        });
      });

      return jobs;
    },
  };
}
