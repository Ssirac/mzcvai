/**
 * Personio careers feed — DIRECT-employer hospitality jobs (Layer 1).
 *
 * Many German hospitality employers (Vapiano, NORDSEE, limehome, …) recruit
 * through Personio, which publishes a free, public XML job feed per company at
 *   https://<company>.jobs.personio.de/xml   (the <workzag-jobs> feed)
 *
 * Why this source matters here: unlike the big boards (which hide the employer
 * behind a portal), each listing is a NAMED employer with its own website — so
 * the enrichment step can discover a real bewerbung@ address, turning these into
 * *sendable* jobs. That directly attacks our volume bottleneck (most matches
 * have no employer email) for exactly the professions our candidates have.
 *
 * Per-company by nature: SEED holds verified feeds; add more at runtime via
 *   PERSONIO_COMPANIES="sub|https://maindomain.de, sub2, …"
 * (subdomain, optionally with the main website so enrichment scrapes the right
 * domain) — no code change or deploy needed.
 *
 * Legal note: not legal advice. The XML feed is public and intended for job
 * aggregation/indexing; we still store only generic company contacts.
 */

import axios from "axios";
import { load } from "cheerio";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

interface PersonioCompany {
  sub: string;        // Personio subdomain, e.g. "vapiano"
  name: string;       // display name stored as Employer.name
  website?: string;   // main site — lets enrichment find bewerbung@ (else guessed from name)
}

// Verified working feeds (checked live). Extend via PERSONIO_COMPANIES.
const SEED: PersonioCompany[] = [
  { sub: "vapiano", name: "Vapiano", website: "https://www.vapiano.de" },
  { sub: "nordsee", name: "NORDSEE", website: "https://www.nordsee.com" },
  { sub: "limehome", name: "limehome", website: "https://www.limehome.com" },
];

// Merge the seed with PERSONIO_COMPANIES ("sub|website, sub2, …"), de-duped by
// subdomain (an env entry may add a website to a seeded company).
function companies(): PersonioCompany[] {
  const extra: PersonioCompany[] = (process.env.PERSONIO_COMPANIES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sub, website] = entry.split("|").map((x) => x.trim());
      return { sub: (sub || "").toLowerCase(), name: sub || "", website: website || undefined };
    })
    .filter((c) => c.sub);

  const map = new Map<string, PersonioCompany>();
  for (const c of [...SEED, ...extra]) map.set(c.sub, { ...map.get(c.sub), ...c });
  return Array.from(map.values());
}

export function personioCompanyCount(): number {
  return companies().length;
}

function isUniqueError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// Resolve (or create) the employer for a company. Employer is unique by
// (name, website) — the DB's @@unique — so when a website is set, ALL of a
// company's listings across regions must share ONE row (creating a per-region
// row would violate the constraint). Without a website, key by name+region like
// the other sources (a NULL website is distinct in Postgres → no collision). A
// create race falls back to re-fetching the winner.
async function resolveEmployer(
  company: PersonioCompany,
  region: string,
  city: string | null,
  signal: SponsorshipSignal,
): Promise<{ employer: { id: string }; created: boolean }> {
  if (company.website) {
    const existing = await prisma.employer.findFirst({ where: { name: company.name, website: company.website } });
    if (existing) return { employer: existing, created: false };
    try {
      const employer = await prisma.employer.create({
        data: { name: company.name, city, region, sponsorshipSignal: signal, website: company.website },
      });
      return { employer, created: true };
    } catch (err) {
      if (isUniqueError(err)) {
        const again = await prisma.employer.findFirst({ where: { name: company.name, website: company.website } });
        if (again) return { employer: again, created: false };
      }
      throw err;
    }
  }
  const existing = await prisma.employer.findFirst({ where: { name: company.name, region } });
  if (existing) return { employer: existing, created: false };
  const employer = await prisma.employer.create({
    data: { name: company.name, city, region, sponsorshipSignal: signal },
  });
  return { employer, created: true };
}

function feedUrl(sub: string): string {
  return `https://${sub}.jobs.personio.de/xml`;
}
function jobUrl(sub: string, id: string): string {
  return `https://${sub}.jobs.personio.de/job/${id}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

// Map a Personio "office" string to our canonical region (best-effort). Offices
// can carry extra detail ("Frankfurt am Main Hanauer Landstraße"), so match on
// substrings.
function normalizeRegion(office: string): string {
  const i = (office || "").toLowerCase();
  if (i.includes("nordrhein") || i.includes("köln") || i.includes("koeln") || i.includes("düsseldorf") || i.includes("dusseldorf") || i.includes("dortmund") || i.includes("essen") || i.includes("bonn") || i.includes("duisburg")) return "NRW";
  if (i.includes("münchen") || i.includes("munich") || i.includes("muenchen") || i.includes("bayern") || i.includes("nürnberg") || i.includes("nuremberg") || i.includes("augsburg")) return "Bayern";
  if (i.includes("berlin")) return "Berlin";
  if (i.includes("hamburg")) return "Hamburg";
  if (i.includes("frankfurt") || i.includes("hessen") || i.includes("wiesbaden") || i.includes("darmstadt")) return "Hessen";
  if (i.includes("stuttgart") || i.includes("baden") || i.includes("karlsruhe") || i.includes("mannheim") || i.includes("freiburg") || i.includes("heidelberg")) return "Baden-Württemberg";
  if (i.includes("dresden") || i.includes("leipzig") || i.includes("sachsen")) return "Sachsen";
  if (i.includes("hannover") || i.includes("niedersachsen") || i.includes("braunschweig") || i.includes("osnabrück")) return "Niedersachsen";
  if (i.includes("bremen")) return "Bremen";
  if (i.includes("mainz") || i.includes("koblenz") || i.includes("ludwigshafen") || i.includes("rheinland-pfalz")) return "Rheinland-Pfalz";
  if (i.includes("kiel") || i.includes("lübeck") || i.includes("schleswig")) return "Schleswig-Holstein";
  return "Deutschland";
}

const EXPLICIT = ["visa", "visum", "sponsor", "relocation", "relocate", "work permit", "blue card", "blaue karte"];
const LIKELY = ["english", "englisch", "international", "quereinsteiger", "fachkräfte", "fachkraefte"];
function detectSignal(text: string): SponsorshipSignal {
  const lower = text.toLowerCase();
  if (EXPLICIT.some((k) => lower.includes(k))) return "YES";
  if (LIKELY.some((k) => lower.includes(k))) return "LIKELY";
  return "UNKNOWN";
}

interface PersonioJob {
  id: string;
  title: string;
  office: string;
  category: string;
  department: string;
  employmentType: string;
  description: string;
  createdAt: Date | null;
}

// Parse one company's <workzag-jobs> XML into raw jobs. Reads direct children by
// tag name (not CSS selectors) so Personio's camelCase tags survive cheerio.
function parseFeed(xml: string): PersonioJob[] {
  const $ = load(xml, { xmlMode: true });
  const jobs: PersonioJob[] = [];
  $("position").each((_, pos) => {
    const rec: Record<string, string> = {};
    const desc: string[] = [];
    $(pos).children().each((_, ch) => {
      const el = ch as { name?: string; tagName?: string };
      const tag = el.name || el.tagName || "";
      if (tag === "jobDescriptions") {
        $(ch).children().each((_, jd) => {
          $(jd).children().each((_, v) => {
            const vt = (v as { name?: string; tagName?: string }).name || (v as { tagName?: string }).tagName;
            if (vt === "value") desc.push(stripHtml($(v).text()));
          });
        });
      } else {
        rec[tag] = $(ch).text().trim();
      }
    });
    if (!rec.id || !rec.name) return;
    const created = rec.createdAt ? new Date(rec.createdAt) : null;
    jobs.push({
      id: rec.id,
      title: rec.name,
      office: rec.office || "",
      category: rec.recruitingCategory || "",
      department: rec.department || "",
      employmentType: rec.employmentType || "",
      description: desc.join(" ").trim(),
      createdAt: created && !isNaN(created.getTime()) ? created : null,
    });
  });
  return jobs;
}

// A job is relevant to this beruf if a search keyword appears in what the role
// is ACTUALLY about — title + Personio's own category/department — not the long
// description body (which would over-match).
function matchesKeyword(job: PersonioJob, keywords: string[]): boolean {
  const hay = `${job.title} ${job.category} ${job.department}`.toLowerCase();
  return keywords.some((kw) => {
    const tokens = kw.toLowerCase().split(/[\s/,-]+/).filter((t) => t.length >= 4);
    return tokens.length === 0 ? false : tokens.some((t) => hay.includes(t));
  });
}

/**
 * Ingest Personio jobs for a beruf+region across all configured companies.
 * Mirrors the IngestResult shape of the other sources.
 */
export async function ingestPersonio(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const allGermany = opts.region === "Deutschland";
  const list = companies();

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "personio", status: "running" },
  });

  try {
    for (const company of list) {
      let xml: string;
      try {
        const res = await axios.get<string>(feedUrl(company.sub), {
          responseType: "text",
          headers: { "User-Agent": "MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de)" },
          timeout: 15000,
        });
        xml = typeof res.data === "string" ? res.data : String(res.data);
      } catch (err) {
        result.errors.push(`Personio ${company.sub}: ${(err as Error).message}`);
        continue;
      }

      let jobs: PersonioJob[];
      try {
        jobs = parseFeed(xml);
      } catch (err) {
        result.errors.push(`Personio ${company.sub} parse: ${(err as Error).message}`);
        continue;
      }

      for (const job of jobs) {
        try {
          if (!matchesKeyword(job, keywords)) continue;
          if (isNonGermanLocation(job.office)) continue; // Germany only (limehome etc. list AT/CH)
          if (isPartTimeJob(job.title, [job.employmentType], job.description)) continue;

          const region = normalizeRegion(job.office);
          if (!allGermany && region !== opts.region && region !== "Deutschland") continue;

          const sourceRef = `personio:${company.sub}:${job.id}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) {
            // Refresh recency; also null out any postedAt (see below) so rows
            // created before that fix stop being hidden by the age cap.
            await prisma.vacancy.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), postedAt: null } });
            result.vacanciesUpdated++;
            continue;
          }

          const signal = detectSignal(`${job.title} ${job.description}`);
          // One employer per company (keyed by name+website); enrichment uses the
          // website to find a bewerbung@ address.
          const { employer, created } = await resolveEmployer(company, region, job.office || null, signal);
          if (created) result.employersNew++;

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.title,
              beruf: opts.beruf,
              region,
              source: "personio",
              url: jobUrl(company.sub, job.id),
              description: job.description.slice(0, 5000) || null,
              employmentType: job.employmentType || null,
              sourceRef,
              // Applications go through the Personio portal; the employer email
              // (once enrichment finds it) is what makes the job sendable.
              applyChannel: "FORM" as ApplyChannel,
              applyValue: jobUrl(company.sub, job.id),
              // Deliberately NULL, not createdAt: Personio positions stay open
              // for months/years (createdAt is often 2021!), but every job in the
              // feed is CURRENTLY open. Storing the ancient createdAt as postedAt
              // would trip the fresh-view's 60-day age cap and hide live roles.
              // Freshness for a live feed is tracked by lastSeenAt instead (goes
              // stale → pruned once the job drops out of the feed).
              postedAt: null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`Personio ${company.sub}/${job.id}: ${(err as Error).message}`);
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
    });
    throw err;
  }

  return result;
}
