/**
 * Direct company career-page ingestion (opt-in).
 *
 * For a configured list of employer career-page URLs (FIRECRAWL_CAREER_PAGES),
 * Firecrawl scrapes the page and Claude extracts the job postings on it. This
 * reaches big-company custom ATS sites (Diehl, Sparkasse, …) that neither the API
 * feeds nor the CSS scrapers cover — and, being direct employers, exposes the
 * company's own site for email discovery / form apply.
 *
 * Generalizable: add any company by appending its career URL to the env var — no
 * per-site scraper. OPT-IN + fail-soft: no-op unless FIRECRAWL_API_KEY and
 * FIRECRAWL_CAREER_PAGES are set; any error degrades to a logged empty result.
 *
 * Cost-bounded: each page is re-crawled at most every CAREER_CRAWL_MIN_HOURS
 * (default 6h), so the per-beruf ingest loop that calls this ~30×/cycle actually
 * hits the network once. One Firecrawl scrape + one Haiku extraction per page.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel } from "@prisma/client";
import { anthropic, extractText } from "@/lib/anthropic";
import { firecrawlScrape, firecrawlAvailable } from "@/services/firecrawl";
import { isNonGermanLocation, isPartTimeJob } from "@/lib/berufMap";
import type { IngestResult } from "@/services/arbeitsagentur";

export function careerPagesEnabled(): boolean {
  return firecrawlAvailable() && !!process.env.FIRECRAWL_CAREER_PAGES?.trim();
}

function careerUrls(): string[] {
  return (process.env.FIRECRAWL_CAREER_PAGES ?? "")
    .split(/[,\n]/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
}

// In-memory guard so the ~30 per-beruf ingest calls in one cycle don't re-crawl
// the same pages. Persists for the life of the Railway process.
const lastCrawledAt = new Map<string, number>();

interface ExtractedJob { title: string; url: string; location?: string }

// Ask Claude to pull the job postings out of the scraped career page. Structure
// only (the public page markdown) — no candidate data involved.
async function extractJobs(pageUrl: string, markdown: string, links: string[]): Promise<ExtractedJob[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const md = markdown.slice(0, 12000);
  const linkSample = links.slice(0, 150).join("\n");
  const prompt = `Dies ist der Inhalt einer Karriere-/Stellenseite eines Unternehmens (URL: ${pageUrl}).
Extrahiere die dort gelisteten OFFENEN STELLEN. Für jede Stelle: den Titel und den Link zur Detail-/Bewerbungsseite (absolute URL; wähle aus den Links den passenden). Wenn ein Arbeitsort erkennbar ist, gib ihn an.

Gib AUSSCHLIESSLICH ein JSON-Array zurück, ohne Erklärung:
[{"title":"...","url":"https://...","location":"..."}]
Wenn keine konkreten Stellen erkennbar sind, gib [] zurück. Max. 30 Einträge.

SEITENINHALT (Markdown):
"""${md}"""

LINKS AUF DER SEITE:
${linkSample}`;
  try {
    const message = await anthropic.messages.create({
      model: process.env.CAREER_EXTRACT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = extractText(message).replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((j): j is ExtractedJob => !!j && typeof (j as ExtractedJob).title === "string" && typeof (j as ExtractedJob).url === "string")
      .map((j) => ({ title: j.title.slice(0, 200), url: j.url, location: typeof j.location === "string" ? j.location.slice(0, 120) : undefined }))
      .slice(0, 30);
  } catch {
    return [];
  }
}

function companyFromUrl(url: string): { name: string; website: string; domain: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const core = host.replace(/^(karriere|jobs?|career|recruiting|stellen)\./, "").split(".")[0];
    const name = core.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || host;
    return { name, website: `${u.protocol}//${u.hostname}`, domain: host };
  } catch {
    return null;
  }
}

function regionFrom(text: string): string {
  const i = text.toLowerCase();
  if (/nordrhein|köln|koeln|düsseldorf|dortmund|essen|recklinghausen|duisburg/.test(i)) return "NRW";
  if (/münchen|munich|bayern|nürnberg|augsburg|überlingen|ueberlingen/.test(i)) return "Bayern";
  if (/berlin/.test(i)) return "Berlin";
  if (/hamburg/.test(i)) return "Hamburg";
  if (/frankfurt|hessen|wiesbaden|kassel/.test(i)) return "Hessen";
  if (/stuttgart|baden|karlsruhe|mannheim|freiburg/.test(i)) return "Baden-Württemberg";
  if (/dresden|leipzig|sachsen/.test(i)) return "Sachsen";
  if (/hannover|niedersachsen|braunschweig/.test(i)) return "Niedersachsen";
  if (/bremen/.test(i)) return "Bremen";
  return "Deutschland";
}

/**
 * Ingest jobs from the configured career pages. Ignores opts.beruf (a career page
 * lists whatever the company has); the per-page time guard keeps repeat calls in
 * one cycle cheap.
 */
export async function ingestCareerPages(): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  if (!careerPagesEnabled()) return result;

  const minMs = Math.max(1, parseFloat(process.env.CAREER_CRAWL_MIN_HOURS ?? "6")) * 60 * 60 * 1000;
  const now = Date.now();

  const run = await prisma.ingestionRun.create({
    data: { beruf: "career-pages", region: "Deutschland", source: "career-pages", status: "running" },
  });

  try {
    for (const pageUrl of careerUrls()) {
      if (now - (lastCrawledAt.get(pageUrl) ?? 0) < minMs) continue; // crawled recently
      lastCrawledAt.set(pageUrl, now);

      const co = companyFromUrl(pageUrl);
      if (!co) continue;

      const scraped = await firecrawlScrape(pageUrl, { formats: ["markdown", "links"] });
      if (!scraped) { result.errors.push(`${co.name}: scrape failed`); continue; }

      const jobs = await extractJobs(pageUrl, scraped.markdown, scraped.links);
      if (jobs.length === 0) { result.errors.push(`${co.name}: no jobs extracted`); continue; }

      // One employer per configured company (by name+website), reused across jobs.
      let employer = await prisma.employer.findFirst({ where: { name: co.name, website: co.website } });
      if (!employer) {
        employer = await prisma.employer.create({
          data: { name: co.name, region: "Deutschland", website: co.website, sponsorshipSignal: "UNKNOWN" },
        });
        result.employersNew++;
      }

      for (const job of jobs) {
        try {
          let jobUrl = job.url;
          try { jobUrl = new URL(job.url, pageUrl).toString(); } catch { /* keep as-is */ }
          const locText = `${job.title} ${job.location ?? ""}`;
          if (isNonGermanLocation(locText)) continue;           // Germany only
          if (isPartTimeJob(job.title, [], locText)) continue;  // full-time only

          const sourceRef = `career:${createHash("sha1").update(jobUrl).digest("hex").slice(0, 16)}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) {
            await prisma.vacancy.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
            result.vacanciesUpdated++;
            continue;
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.title || "Stelle",
              beruf: job.title || "Stelle",
              region: regionFrom(job.location ?? co.name),
              source: "career-pages",
              url: jobUrl,
              description: null,
              sourceRef,
              applyChannel: "FORM" as ApplyChannel, // apply on the company site
              applyValue: jobUrl,
              postedAt: null,
              rawData: { careerPage: pageUrl, title: job.title, location: job.location ?? null } as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`${co.name} job: ${(err as Error).message.slice(0, 120)}`);
        }
      }
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        vacanciesNew: result.vacanciesNew,
        vacanciesUpdated: result.vacanciesUpdated,
        employersNew: result.employersNew,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: (err as Error).message, finishedAt: new Date() },
    }).catch(() => {});
    result.errors.push((err as Error).message);
  }

  return result;
}
