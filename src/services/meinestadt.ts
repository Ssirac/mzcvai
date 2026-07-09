/**
 * meineStadt (jobs.meinestadt.de) — job source (Layer 1), BETA scraper.
 *
 * meineStadt has no free public jobs API, so we read the search results page
 * with the shared headless browser and extract schema.org `JobPosting` JSON-LD
 * blocks (which German job portals embed for Google for Jobs). JSON-LD is far
 * more stable than CSS selectors — it survives layout changes.
 *
 * Opt-in via MEINESTADT_ENABLED=true (scraping is heavier than an API call and
 * subject to the site's terms; keep it off unless you want it in the mix).
 */

import { launchBrowser } from "@/lib/browser";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

function normalizeRegion(loc: string): string {
  const i = (loc ?? "").toLowerCase();
  if (i.includes("nordrhein") || i.includes("köln") || i.includes("düsseldorf") || i.includes("dortmund") || i.includes("essen")) return "NRW";
  if (i.includes("bayern") || i.includes("münchen") || i.includes("nürnberg")) return "Bayern";
  if (i.includes("berlin")) return "Berlin";
  if (i.includes("hamburg")) return "Hamburg";
  if (i.includes("hessen") || i.includes("frankfurt")) return "Hessen";
  if (i.includes("baden") || i.includes("stuttgart")) return "Baden-Württemberg";
  if (i.includes("sachsen") || i.includes("dresden") || i.includes("leipzig")) return "Sachsen";
  if (i.includes("niedersachsen") || i.includes("hannover")) return "Niedersachsen";
  if (i.includes("bremen")) return "Bremen";
  return "Deutschland";
}

const EXPLICIT = ["visum", "visa", "sponsor", "relocation", "work permit", "blaue karte", "drittstaaten"];
const LIKELY = ["english", "englisch", "international", "fachkräfte"];
function detectSignal(text: string): SponsorshipSignal {
  const t = text.toLowerCase();
  if (EXPLICIT.some((k) => t.includes(k))) return "YES";
  if (LIKELY.some((k) => t.includes(k))) return "LIKELY";
  return "UNKNOWN";
}

const RECRUITMENT = ["bewerbung", "bewerbungen", "karriere", "jobs", "job", "recruiting", "personal", "hr", "career"];
const GENERAL = ["info", "kontakt", "contact", "office"];
function extractGenericEmail(text: string): string | null {
  const all = (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) => e.toLowerCase());
  const find = (pre: string[]) => all.find((e) => { const l = e.split("@")[0] ?? ""; return pre.some((p) => l === p || l.startsWith(p)); });
  return find(RECRUITMENT) ?? find(GENERAL) ?? null;
}

function titleRelevant(title: string, keywords: string[]): boolean {
  const t = (title ?? "").toLowerCase();
  return keywords.some((kw) => {
    const tokens = kw.toLowerCase().split(/[\s/,-]+/).filter((x) => x.length >= 4);
    return tokens.length === 0 ? true : tokens.some((x) => t.includes(x));
  });
}

// Minimal shape of a schema.org JobPosting we read from JSON-LD.
interface JsonLdJob {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
  employmentType?: string | string[];
  datePosted?: string;
  url?: string;
  identifier?: { value?: string } | string;
}

// Walk arbitrary JSON-LD (objects, arrays, @graph) and collect every JobPosting.
function collectJobPostings(node: unknown, out: JsonLdJob[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) collectJobPostings(n, out); return; }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) out.push(obj as JsonLdJob);
  for (const k of Object.keys(obj)) {
    if (k === "@type") continue;
    collectJobPostings(obj[k], out);
  }
}

function locationString(jobLocation: unknown): string {
  const places = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const parts: string[] = [];
  for (const p of places) {
    if (!p) continue;
    if (typeof p === "string") { parts.push(p); continue; }
    const addr = (p as { address?: unknown }).address ?? p;
    if (typeof addr === "string") { parts.push(addr); continue; }
    const a = addr as { addressLocality?: string; addressRegion?: string; addressCountry?: unknown };
    const country = typeof a.addressCountry === "string" ? a.addressCountry : (a.addressCountry as { name?: string })?.name;
    parts.push([a.addressLocality, a.addressRegion, country].filter(Boolean).join(" "));
  }
  return parts.join(" ");
}

function orgName(org: JsonLdJob["hiringOrganization"]): string {
  if (typeof org === "string") return org.trim();
  return (org?.name ?? "").trim();
}

export async function ingestMeinestadt(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const maxPages = Math.min(opts.maxPages ?? 3, 5);

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "meinestadt", status: "running" },
  });

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent("MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de; +https://mz-personalvermittlung.de)");
    await page.setDefaultTimeout(20000);

    for (let p = 1; p <= maxPages; p++) {
      const url = `https://jobs.meinestadt.de/deutschland/suche?words=${encodeURIComponent(opts.beruf)}&page=${p}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      } catch (err) {
        result.errors.push(`meinestadt page ${p}: ${(err as Error).message}`);
        break;
      }

      const blocks: string[] = await page.$$eval('script[type="application/ld+json"]', (els) =>
        els.map((e) => e.textContent ?? "")
      );
      const jobs: JsonLdJob[] = [];
      for (const block of blocks) {
        try { collectJobPostings(JSON.parse(block), jobs); } catch { /* skip malformed JSON-LD */ }
      }
      if (jobs.length === 0) {
        if (p === 1) result.errors.push("meinestadt: keine JobPosting-Strukturdaten gefunden (Seite/Struktur prüfen)");
        break;
      }

      for (const job of jobs) {
        try {
          const title = (job.title ?? "").toString().trim();
          if (!title || !titleRelevant(title, keywords)) continue;
          const loc = locationString(job.jobLocation);
          if (isNonGermanLocation(loc)) continue; // Germany only
          const empTypes = Array.isArray(job.employmentType) ? job.employmentType : job.employmentType ? [job.employmentType] : [];
          const desc = typeof job.description === "string" ? job.description : "";
          if (isPartTimeJob(title, empTypes, desc)) continue;

          const jobUrl = (job.url ?? "").toString() || null;
          const idPart = typeof job.identifier === "object" ? (job.identifier?.value ?? "") : (job.identifier ?? "");
          const sourceRef = `meinestadt:${idPart || jobUrl || title}`.slice(0, 190);
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) { result.vacanciesUpdated++; continue; }

          const region = normalizeRegion(loc);
          const company = orgName(job.hiringOrganization) || "Unbekannt";
          const signal = detectSignal(`${title} ${desc}`);
          const email = extractGenericEmail(desc);

          let employer = await prisma.employer.findFirst({ where: { name: company, region } });
          if (!employer) {
            employer = await prisma.employer.create({
              data: { name: company, city: null, region, sponsorshipSignal: signal, genericEmail: email },
            });
            result.employersNew++;
          } else if (email && !employer.genericEmail) {
            await prisma.employer.update({ where: { id: employer.id }, data: { genericEmail: email } });
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: title.slice(0, 300),
              beruf: opts.beruf,
              region,
              source: "meinestadt",
              url: jobUrl,
              description: desc.slice(0, 5000) || null,
              employmentType: empTypes[0] ?? null,
              sourceRef,
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? jobUrl ?? null,
              postedAt: job.datePosted ? new Date(job.datePosted) : null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`meinestadt job: ${(err as Error).message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "completed", vacanciesNew: result.vacanciesNew, vacanciesUpdated: result.vacanciesUpdated, employersNew: result.employersNew, finishedAt: new Date() },
    });
  } catch (err) {
    result.errors.push(`meinestadt: ${(err as Error).message}`);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: (err as Error).message, finishedAt: new Date() },
    }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return result;
}
