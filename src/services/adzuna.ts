/**
 * Adzuna — third ingestion source (Layer 1).
 *
 * Adzuna is a job AGGREGATOR: it pulls listings from across German job boards
 * AND directly from companies' own career pages, then exposes them via a free,
 * legal API. This gives "all German job sites + company vacancies" through one
 * compliant endpoint (vs. scraping each site, which violates their terms).
 *
 * Free API keys: https://developer.adzuna.com  → ADZUNA_APP_ID + ADZUNA_APP_KEY
 *
 * Legal note: This is not legal advice.
 */

import axios from "axios";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

const BASE = "https://api.adzuna.com/v1/api/jobs/de/search";

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  redirect_url?: string;
  created?: string;
  contract_time?: string;
  category?: { label?: string };
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeRegion(area: string[] | undefined, display: string | undefined): string {
  const hay = ((area ?? []).join(" ") + " " + (display ?? "")).toLowerCase();
  if (hay.includes("nordrhein") || hay.includes("köln") || hay.includes("düsseldorf") || hay.includes("dortmund") || hay.includes("essen")) return "NRW";
  if (hay.includes("bayern") || hay.includes("münchen") || hay.includes("nürnberg")) return "Bayern";
  if (hay.includes("berlin")) return "Berlin";
  if (hay.includes("hamburg")) return "Hamburg";
  if (hay.includes("hessen") || hay.includes("frankfurt")) return "Hessen";
  if (hay.includes("baden") || hay.includes("stuttgart")) return "Baden-Württemberg";
  if (hay.includes("sachsen") || hay.includes("dresden") || hay.includes("leipzig")) return "Sachsen";
  if (hay.includes("niedersachsen") || hay.includes("hannover")) return "Niedersachsen";
  if (hay.includes("bremen")) return "Bremen";
  return "Deutschland";
}

const EXPLICIT = ["visum", "visa", "sponsor", "relocation", "work permit", "blue card", "blaue karte", "drittstaaten"];
const LIKELY = ["english", "englisch", "international", "fachkräfte", "we welcome"];

function detectSignal(text: string): SponsorshipSignal {
  const t = text.toLowerCase();
  if (EXPLICIT.some((k) => t.includes(k))) return "YES";
  if (LIKELY.some((k) => t.includes(k))) return "LIKELY";
  return "UNKNOWN";
}

const RECRUITMENT = ["bewerbung", "bewerbungen", "karriere", "jobs", "job", "recruiting", "recruitment", "personal", "hr", "career", "careers"];
const GENERAL = ["info", "kontakt", "contact", "office"];
function extractGenericEmail(text: string): string | null {
  const all = (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) => e.toLowerCase());
  const find = (pre: string[]) => all.find((e) => { const l = e.split("@")[0] ?? ""; return pre.some((p) => l === p || l.startsWith(p)); });
  return find(RECRUITMENT) ?? find(GENERAL) ?? null;
}

// A keyword is "relevant" if it appears in the title (Adzuna already filters by `what`)
function titleRelevant(job: AdzunaJob, keywords: string[]): boolean {
  const title = (job.title ?? "").toLowerCase();
  return keywords.some((kw) => {
    const tokens = kw.toLowerCase().split(/[\s/,-]+/).filter((t) => t.length >= 4);
    return tokens.length === 0 ? true : tokens.some((t) => title.includes(t));
  });
}

export async function ingestAdzuna(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    result.errors.push("Adzuna keys not configured (ADZUNA_APP_ID / ADZUNA_APP_KEY)");
    return result;
  }

  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const maxPages = opts.maxPages ?? 6; // aggregator — pull more to balance sources
  const allGermany = opts.region === "Deutschland";

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "adzuna", status: "running" },
  });

  try {
    for (let page = 1; page <= maxPages; page++) {
      let resp: AdzunaResponse;
      try {
        const res = await axios.get<AdzunaResponse>(`${BASE}/${page}`, {
          params: {
            app_id: appId,
            app_key: appKey,
            results_per_page: 50,
            what: opts.beruf,
            ...(allGermany ? {} : { where: opts.region }),
            "content-type": "application/json",
          },
          headers: { "User-Agent": "MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de)" },
          timeout: 15000,
        });
        resp = res.data;
      } catch (err) {
        result.errors.push(`Adzuna page ${page}: ${(err as Error).message}`);
        break;
      }

      const jobs = resp.results ?? [];
      if (jobs.length === 0) break;

      for (const job of jobs) {
        try {
          if (!titleRelevant(job, keywords)) continue;
          if (isNonGermanLocation(`${job.location?.display_name ?? ""} ${(job.location?.area ?? []).join(" ")}`)) continue; // Germany only
          if (isPartTimeJob(job.title, job.contract_time ? [job.contract_time] : [], job.description ?? "")) continue;

          const sourceRef = `adzuna:${job.id}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) { result.vacanciesUpdated++; continue; }

          const region = normalizeRegion(job.location?.area, job.location?.display_name);
          const text = `${job.title} ${job.description ?? ""}`;
          const signal = detectSignal(text);
          const email = extractGenericEmail(job.description ?? "");
          const companyName = job.company?.display_name?.trim() || "Unbekannt";

          let employer = await prisma.employer.findFirst({ where: { name: companyName, region } });
          if (!employer) {
            employer = await prisma.employer.create({
              data: { name: companyName, city: job.location?.display_name || null, region, sponsorshipSignal: signal, genericEmail: email },
            });
            result.employersNew++;
          } else {
            const patch: Record<string, unknown> = {};
            if (signal !== "UNKNOWN" && employer.sponsorshipSignal === "UNKNOWN") patch.sponsorshipSignal = signal;
            if (email && !employer.genericEmail) patch.genericEmail = email;
            if (Object.keys(patch).length) await prisma.employer.update({ where: { id: employer.id }, data: patch });
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.title || "Stelle",
              beruf: opts.beruf,
              region,
              source: "adzuna",
              url: job.redirect_url || null,
              description: (job.description ?? "").slice(0, 5000) || null,
              employmentType: job.contract_time || null,
              sourceRef,
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? job.redirect_url ?? null,
              postedAt: job.created ? new Date(job.created) : null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`Adzuna job ${job.id}: ${(err as Error).message}`);
        }
      }

      await sleep(400);
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "completed", vacanciesNew: result.vacanciesNew, vacanciesUpdated: result.vacanciesUpdated, employersNew: result.employersNew, finishedAt: new Date() },
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
