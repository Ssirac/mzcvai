/**
 * JSearch (RapidAPI) — Google for Jobs aggregator source (Layer 1).
 *
 * Google for Jobs indexes postings from LinkedIn, Indeed, StepStone, company
 * career pages and more; JSearch exposes those results via a legal API. This is
 * the practical way to surface LinkedIn-published jobs without scraping
 * LinkedIn (which has no public job-search API and forbids scraping).
 *
 * Key: https://rapidapi.com/ → subscribe to "JSearch" (free tier available)
 *      → RAPIDAPI_KEY env var.
 */

import axios from "axios";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

const BASE = "https://jsearch.p.rapidapi.com/search";

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name?: string;
  employer_website?: string | null;
  job_publisher?: string; // e.g. "LinkedIn", "Indeed"
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_description?: string;
  job_apply_link?: string;
  job_employment_type?: string | null; // FULLTIME / PARTTIME / ...
  job_posted_at_datetime_utc?: string | null;
}

interface JSearchResponse {
  data?: JSearchJob[];
}

function normalizeRegion(city: string | null | undefined, state: string | null | undefined): string {
  const i = `${city ?? ""} ${state ?? ""}`.toLowerCase();
  if (i.includes("nordrhein") || i.includes("köln") || i.includes("düsseldorf") || i.includes("dortmund") || i.includes("essen")) return "NRW";
  if (i.includes("bayern") || i.includes("münchen") || i.includes("nürnberg") || i.includes("bavaria") || i.includes("munich")) return "Bayern";
  if (i.includes("berlin")) return "Berlin";
  if (i.includes("hamburg")) return "Hamburg";
  if (i.includes("hessen") || i.includes("frankfurt") || i.includes("hesse")) return "Hessen";
  if (i.includes("baden") || i.includes("stuttgart")) return "Baden-Württemberg";
  if (i.includes("sachsen") || i.includes("dresden") || i.includes("leipzig") || i.includes("saxony")) return "Sachsen";
  if (i.includes("niedersachsen") || i.includes("hannover") || i.includes("lower saxony")) return "Niedersachsen";
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

export async function ingestJSearch(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    result.errors.push("JSearch key not configured (RAPIDAPI_KEY)");
    return result;
  }

  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const allGermany = opts.region === "Deutschland";
  // JSearch charges per request — keep pages low; each page ≈ 10 results.
  const maxPages = Math.min(opts.maxPages ?? 2, 3);

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "jsearch", status: "running" },
  });

  try {
    for (let page = 1; page <= maxPages; page++) {
      let jobs: JSearchJob[];
      try {
        const res = await axios.get<JSearchResponse>(BASE, {
          params: {
            query: `${opts.beruf} in ${allGermany ? "Germany" : opts.region + ", Germany"}`,
            page,
            num_pages: 1,
            country: "de",
            language: "de",
          },
          headers: {
            "X-RapidAPI-Key": key,
            "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
          },
          timeout: 20000,
        });
        jobs = res.data.data ?? [];
      } catch (err) {
        const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
        const body = ax.response?.data ? JSON.stringify(ax.response.data).slice(0, 200) : "";
        result.errors.push(`JSearch page ${page}: ${ax.message}${body ? ` | ${body}` : ""}`);
        break;
      }
      if (jobs.length === 0) break;

      for (const job of jobs) {
        try {
          if (!titleRelevant(job.job_title, keywords)) continue;
          if ((job.job_country ?? "DE").toUpperCase() !== "DE") continue; // Germany only
          if (isNonGermanLocation(`${job.job_city ?? ""} ${job.job_state ?? ""}`)) continue;
          if (isPartTimeJob(job.job_title, job.job_employment_type ? [job.job_employment_type] : [], job.job_description ?? "")) continue;

          const sourceRef = `jsearch:${job.job_id}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) { result.vacanciesUpdated++; continue; }

          const region = normalizeRegion(job.job_city, job.job_state);
          const text = `${job.job_title} ${job.job_description ?? ""}`;
          const signal = detectSignal(text);
          const email = extractGenericEmail(job.job_description ?? "");
          const companyName = (job.employer_name ?? "").trim() || "Unbekannt";

          let employer = await prisma.employer.findFirst({ where: { name: companyName, region } });
          if (!employer) {
            employer = await prisma.employer.create({
              data: {
                name: companyName,
                city: job.job_city || null,
                region,
                sponsorshipSignal: signal,
                genericEmail: email,
                website: job.employer_website || null,
              },
            });
            result.employersNew++;
          } else {
            const patch: Record<string, unknown> = {};
            if (email && !employer.genericEmail) patch.genericEmail = email;
            if (job.employer_website && !employer.website) patch.website = job.employer_website;
            if (Object.keys(patch).length) await prisma.employer.update({ where: { id: employer.id }, data: patch });
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.job_title || "Stelle",
              beruf: opts.beruf,
              region,
              source: `jsearch${job.job_publisher ? ` (${job.job_publisher})` : ""}`.slice(0, 40),
              url: job.job_apply_link || null,
              description: (job.job_description ?? "").slice(0, 5000) || null,
              employmentType: job.job_employment_type || null,
              sourceRef,
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? job.job_apply_link ?? null,
              postedAt: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`JSearch job: ${(err as Error).message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "completed", vacanciesNew: result.vacanciesNew, vacanciesUpdated: result.vacanciesUpdated, employersNew: result.employersNew, finishedAt: new Date() },
    });
  } catch (err) {
    await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "failed", errorMessage: (err as Error).message, finishedAt: new Date() } });
    throw err;
  }

  return result;
}
