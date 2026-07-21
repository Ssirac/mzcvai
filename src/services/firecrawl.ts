/**
 * Firecrawl client — robust web scraping via the Firecrawl HTTPS API.
 *
 * Firecrawl handles JS rendering, proxies, and rate limits, so it reaches pages
 * the direct Puppeteer navigation (or a brittle CSS scrape) gives up on. Used as
 * an OPT-IN fallback: everything here no-ops and returns null/false unless
 * FIRECRAWL_API_KEY is set, so the system is unchanged until a key is provided.
 *
 * Current integration points (see services/autoApply.ts):
 *  - discoverApplyUrl(): find the real "Jetzt bewerben" application link when the
 *    landing page itself has no form (aggregator/redirect/JS-gated apply button).
 *  - isListingDeadViaFirecrawl(): confirm a listing is gone (404/410 or dead-text)
 *    even on JS-rendered pages the puppeteer sweep can't read.
 */

import { load } from "cheerio";

const ENDPOINT = "https://api.firecrawl.dev/v1/scrape";
const SEARCH_ENDPOINT = "https://api.firecrawl.dev/v1/search";

export function firecrawlAvailable(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

export interface FirecrawlSearchItem {
  url: string;
  title: string;
  description: string;
  markdown: string;
}

/**
 * Web search via Firecrawl. When scrape=true each result also carries the page's
 * markdown (one round-trip), so a job posting can be turned into a vacancy without
 * a second fetch. Fail-soft: null on any error / no key.
 */
export async function firecrawlSearch(
  query: string,
  opts?: { limit?: number; scrape?: boolean; timeoutMs?: number },
): Promise<FirecrawlSearchItem[] | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 45000);
  try {
    const body: Record<string, unknown> = { query, limit: opts?.limit ?? 10 };
    if (opts?.scrape) body.scrapeOptions = { formats: ["markdown"] };
    const res = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: unknown;
    };
    if (!res.ok || !data.data) return null;
    // Response shape varies by API version: `data` may be a flat array or an
    // object keyed by source ({ web: [...] }). Handle both.
    const raw = Array.isArray(data.data)
      ? data.data
      : (data.data as { web?: unknown[] }).web ?? [];
    return (raw as Record<string, unknown>[])
      .map((r) => ({
        url: String(r.url ?? ""),
        title: String(r.title ?? ""),
        description: String(r.description ?? ""),
        markdown: String(r.markdown ?? ""),
      }))
      .filter((r) => r.url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface FirecrawlResult {
  markdown: string;
  html: string;
  links: string[];
  statusCode: number | null;
}

export async function firecrawlScrape(
  url: string,
  opts?: { formats?: string[]; timeoutMs?: number },
): Promise<FirecrawlResult | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: opts?.formats ?? ["markdown", "html", "links"], onlyMainContent: false }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean; data?: { markdown?: string; html?: string; links?: string[]; metadata?: { statusCode?: number } };
    };
    if (!res.ok || !data.success || !data.data) return null;
    const d = data.data;
    return { markdown: d.markdown ?? "", html: d.html ?? "", links: d.links ?? [], statusCode: d.metadata?.statusCode ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Anchor/button text that indicates the real application entry point.
const APPLY_TEXT = /jetzt bewerben|online bewerben|zur bewerbung|bewerben|apply now|apply for|application|jetzt einfach bewerben/i;
// URL path fragments that indicate an application form/page.
const APPLY_PATH = /apply|bewerb|application|karriere.*(job|stelle)|jobs?\/.+\/(apply|bewerb)/i;

/**
 * Given a job/landing URL that had no fillable form, find the actual application
 * link on it. Prefers an anchor whose visible text says "Jetzt bewerben", then
 * falls back to any link whose URL path looks like an apply page. Returns an
 * absolute URL, or null.
 */
export async function discoverApplyUrl(pageUrl: string): Promise<string | null> {
  const r = await firecrawlScrape(pageUrl, { formats: ["html", "links"] });
  if (!r) return null;

  const abs = (href: string): string | null => {
    try { return new URL(href, pageUrl).toString(); } catch { return null; }
  };

  // 1) Anchor/button text match (most reliable).
  if (r.html) {
    const $ = load(r.html);
    const els = $("a[href], button").toArray();
    for (const el of els) {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!APPLY_TEXT.test(text)) continue;
      const href = $(el).attr("href") || $(el).attr("data-href") || "";
      const u = href ? abs(href) : null;
      if (u && /^https?:\/\//i.test(u) && u !== pageUrl) return u;
    }
  }

  // 2) Fall back to a link whose URL path looks like an application page.
  for (const l of r.links) {
    const u = abs(l);
    if (u && u !== pageUrl && APPLY_PATH.test(u)) return u;
  }
  return null;
}

const DEAD_PHRASES = [
  "nicht mehr verfügbar", "nicht mehr verfuegbar", "nicht mehr online", "nicht mehr aktuell",
  "stelle ist besetzt", "position wurde besetzt", "abgelaufen", "leider nicht mehr",
  "no longer available", "position filled", "this job has expired", "seite nicht gefunden",
];

/** Confirm a listing is dead via Firecrawl (JS-rendered pages included). */
export async function isListingDeadViaFirecrawl(url: string): Promise<boolean> {
  const r = await firecrawlScrape(url, { formats: ["markdown"] });
  if (!r) return false;
  if (r.statusCode === 404 || r.statusCode === 410) return true;
  const md = r.markdown.toLowerCase();
  return DEAD_PHRASES.some((p) => md.includes(p));
}
