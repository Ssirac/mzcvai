/**
 * Careerjet — job aggregator source (Layer 1).
 *
 * Careerjet indexes listings from thousands of job boards and company sites
 * (including roles cross-posted from LinkedIn/Indeed) and exposes them through a
 * free Public Search API. Germany-scoped via locale_code=de_DE.
 *
 * Free affiliate id: https://www.careerjet.com/partners/api/ → CAREERJET_AFFID
 * Legal note: this is not legal advice.
 */

import axios from "axios";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

const BASE = "https://public.api.careerjet.net/search";

interface CareerjetJob {
  title: string;
  description: string;
  company?: string;
  locations?: string;
  salary?: string;
  url: string;
  date?: string;
}
interface CareerjetResponse {
  type: string;
  jobs?: CareerjetJob[];
  pages?: number;
}

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

export async function ingestCareerjet(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const affid = process.env.CAREERJET_AFFID;
  if (!affid) {
    result.errors.push("Careerjet affiliate id not configured (CAREERJET_AFFID)");
    return result;
  }

  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const allGermany = opts.region === "Deutschland";
  const maxPages = opts.maxPages ?? 4;

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "careerjet", status: "running" },
  });

  try {
    for (let page = 1; page <= maxPages; page++) {
      let data: CareerjetResponse;
      try {
        const res = await axios.get<CareerjetResponse>(BASE, {
          params: {
            keywords: opts.beruf,
            location: allGermany ? "Deutschland" : opts.region,
            locale_code: "de_DE",
            affid,
            pagesize: 50,
            page,
            user_ip: "127.0.0.1",
            user_agent: "MZPersonal-CompanyFinder/1.0",
          },
          timeout: 15000,
        });
        data = res.data;
      } catch (err) {
        result.errors.push(`Careerjet page ${page}: ${(err as Error).message}`);
        break;
      }

      const jobs = data.jobs ?? [];
      if (jobs.length === 0) break;

      for (const job of jobs) {
        try {
          if (!titleRelevant(job.title, keywords)) continue;
          if (isNonGermanLocation(job.locations ?? "")) continue; // Germany only
          if (isPartTimeJob(job.title, [], job.description ?? "")) continue;

          const sourceRef = `careerjet:${job.url}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) { result.vacanciesUpdated++; continue; }

          const region = normalizeRegion(job.locations ?? "");
          const text = `${job.title} ${job.description ?? ""}`;
          const signal = detectSignal(text);
          const email = extractGenericEmail(job.description ?? "");
          const companyName = (job.company ?? "").trim() || "Unbekannt";

          let employer = await prisma.employer.findFirst({ where: { name: companyName, region } });
          if (!employer) {
            employer = await prisma.employer.create({
              data: { name: companyName, city: job.locations || null, region, sponsorshipSignal: signal, genericEmail: email },
            });
            result.employersNew++;
          } else if (email && !employer.genericEmail) {
            await prisma.employer.update({ where: { id: employer.id }, data: { genericEmail: email } });
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: job.title || "Stelle",
              beruf: opts.beruf,
              region,
              source: "careerjet",
              url: job.url || null,
              description: (job.description ?? "").slice(0, 5000) || null,
              sourceRef,
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? job.url ?? null,
              postedAt: job.date ? new Date(job.date) : null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`Careerjet job: ${(err as Error).message}`);
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
