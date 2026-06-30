/**
 * Arbeitnow job board — second ingestion source (Layer 1).
 *
 * Free public JSON API, no key required: https://www.arbeitnow.com/api/job-board-api
 * Arbeitnow is German-focused and lists many English-language / visa-relevant roles,
 * which directly matches MZ's non-EU candidate niche.
 *
 * Legal note: This is not legal advice. The API is public and intended for
 * aggregation; we still store only generic company contacts (never personal HR data).
 */

import axios from "axios";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

const API_URL = "https://www.arbeitnow.com/api/job-board-api";

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

interface ArbeitnowResponse {
  data: ArbeitnowJob[];
  links?: { next?: string | null };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Map a free-text location to our canonical region (best-effort).
function normalizeRegion(location: string): string {
  const i = location.toLowerCase();
  if (i.includes("nordrhein") || i.includes("köln") || i.includes("koeln") || i.includes("düsseldorf") || i.includes("dortmund") || i.includes("essen")) return "NRW";
  if (i.includes("münchen") || i.includes("munich") || i.includes("bayern") || i.includes("nürnberg")) return "Bayern";
  if (i.includes("berlin")) return "Berlin";
  if (i.includes("hamburg")) return "Hamburg";
  if (i.includes("frankfurt") || i.includes("hessen") || i.includes("wiesbaden")) return "Hessen";
  if (i.includes("stuttgart") || i.includes("baden") || i.includes("karlsruhe") || i.includes("mannheim")) return "Baden-Württemberg";
  if (i.includes("dresden") || i.includes("leipzig") || i.includes("sachsen")) return "Sachsen";
  if (i.includes("hannover") || i.includes("niedersachsen")) return "Niedersachsen";
  if (i.includes("bremen")) return "Bremen";
  return "Deutschland";
}

const EXPLICIT = ["visa", "visum", "sponsor", "relocation", "relocate", "work permit", "blue card", "blaue karte"];
const LIKELY = ["english", "englisch", "international", "we welcome", "fachkräfte"];

function detectSignal(text: string, tags: string[]): SponsorshipSignal {
  const lower = (text + " " + tags.join(" ")).toLowerCase();
  if (EXPLICIT.some((k) => lower.includes(k))) return "YES";
  if (LIKELY.some((k) => lower.includes(k))) return "LIKELY";
  return "UNKNOWN";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

// Recruitment-department prefixes preferred over general ones.
const RECRUITMENT_PREFIXES = ["bewerbung", "bewerbungen", "karriere", "jobs", "job", "recruiting", "recruitment", "personal", "hr", "career", "careers", "apply"];
const GENERAL_PREFIXES = ["info", "kontakt", "contact", "office", "mail", "team"];

// Extract a generic (non-personal) company email — GDPR-safe — preferring the
// recruitment department over a general info@ inbox.
function extractGenericEmail(text: string): string | null {
  const all = (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) => e.toLowerCase());
  const matches = (prefixes: string[]) =>
    all.find((email) => {
      const local = email.split("@")[0] ?? "";
      return prefixes.some((p) => local === p || local.startsWith(p));
    });
  return matches(RECRUITMENT_PREFIXES) ?? matches(GENERAL_PREFIXES) ?? null;
}

// Extract the employer's own website from text (not arbeitnow.com)
function extractWebsite(text: string): string | null {
  const m = text.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+\.[a-zA-Z]{2,})(?:\/[^\s"')]*)?/g) ?? [];
  for (const url of m) {
    if (!/arbeitnow\.com|linkedin|xing|indeed|google|facebook|twitter|instagram/i.test(url)) {
      try { const u = new URL(url); return `${u.protocol}//${u.hostname}`; } catch { /* skip */ }
    }
  }
  return null;
}

function matchesKeyword(job: ArbeitnowJob, keywords: string[]): boolean {
  // Match against the TITLE + tags only — not the full description body, which
  // mentions many unrelated words and causes false positives (e.g. "print" in a
  // marketing role). A keyword must appear in what the job is actually about.
  const hay = (job.title + " " + (job.tags ?? []).join(" ")).toLowerCase();
  return keywords.some((kw) => {
    const tokens = kw.toLowerCase().split(/[\s/,-]+/).filter((t) => t.length >= 4);
    return tokens.length === 0 ? false : tokens.some((t) => hay.includes(t));
  });
}

/**
 * Ingest Arbeitnow jobs for a given beruf+region.
 * Mirrors the IngestResult shape used by the Arbeitsagentur ingester.
 */
export async function ingestArbeitnow(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const maxPages = opts.maxPages ?? 6; // general feed — scan more to find relevant roles
  const allGermany = opts.region === "Deutschland";

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "arbeitnow", status: "running" },
  });

  try {
    for (let page = 1; page <= maxPages; page++) {
      let resp: ArbeitnowResponse;
      try {
        const res = await axios.get<ArbeitnowResponse>(API_URL, {
          params: { page },
          headers: { "User-Agent": "MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de)" },
          timeout: 15000,
        });
        resp = res.data;
      } catch (err) {
        result.errors.push(`Arbeitnow page ${page}: ${(err as Error).message}`);
        break;
      }

      const jobs = resp.data ?? [];
      if (jobs.length === 0) break;

      for (const job of jobs) {
        try {
          if (!matchesKeyword(job, keywords)) continue;
          if (isNonGermanLocation(job.location ?? "")) continue; // Germany only
          if (isPartTimeJob(job.title, job.job_types ?? [], job.description ?? "")) continue;

          const region = normalizeRegion(job.location ?? "");
          if (!allGermany && region !== opts.region && region !== "Deutschland") continue;

          const sourceRef = `arbeitnow:${job.slug}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) {
            result.vacanciesUpdated++;
            continue;
          }

          const plain = stripHtml(job.description ?? "");
          const signal = detectSignal(job.title + " " + plain, job.tags ?? []);
          // GDPR-safe: only a generic company address, plus the employer's own site
          const email = extractGenericEmail(job.description ?? "");
          const website = extractWebsite(job.description ?? "");

          // Upsert employer by name + region
          let employer = await prisma.employer.findFirst({
            where: { name: job.company_name, region },
          });
          if (!employer) {
            employer = await prisma.employer.create({
              data: {
                name: job.company_name || "Unbekannt",
                city: job.location || null,
                region,
                sponsorshipSignal: signal,
                genericEmail: email,
                website,
              },
            });
            result.employersNew++;
          } else {
            const patch: Record<string, unknown> = {};
            if (signal !== "UNKNOWN" && employer.sponsorshipSignal === "UNKNOWN") patch.sponsorshipSignal = signal;
            if (email && !employer.genericEmail) patch.genericEmail = email;
            if (website && !employer.website) patch.website = website;
            if (Object.keys(patch).length) {
              await prisma.employer.update({ where: { id: employer.id }, data: patch });
            }
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.title || "Stelle",
              beruf: opts.beruf,
              region,
              source: "arbeitnow",
              url: job.url || null,
              description: plain.slice(0, 5000) || null,
              employmentType: (job.job_types ?? []).join(", ") || null,
              sourceRef,
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? job.url ?? null,
              postedAt: job.created_at ? new Date(job.created_at * 1000) : null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`Arbeitnow job ${job.slug}: ${(err as Error).message}`);
        }
      }

      if (!resp.links?.next) break;
      await sleep(400);
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
