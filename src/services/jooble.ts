/**
 * Jooble — job aggregator source (Layer 1).
 * Free API (requires a key from https://jooble.org/api/about).
 * Aggregates listings from many German job boards and company pages.
 */

import axios from "axios";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

interface JoobleJob {
  title: string;
  location: string;
  snippet: string;
  salary?: string;
  source?: string;
  type?: string;
  link: string;
  company?: string;
  updated?: string;
  id?: number;
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

export async function ingestJooble(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const key = process.env.JOOBLE_API_KEY;
  if (!key) {
    result.errors.push("Jooble key not configured (JOOBLE_API_KEY)");
    return result;
  }

  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const allGermany = opts.region === "Deutschland";
  const maxPages = opts.maxPages ?? 4;

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "jooble", status: "running" },
  });

  try {
    for (let page = 1; page <= maxPages; page++) {
      let jobs: JoobleJob[];
      try {
        const res = await axios.post<{ jobs: JoobleJob[] }>(
          `https://jooble.org/api/${key}`,
          { keywords: opts.beruf, location: allGermany ? "Deutschland" : opts.region, page: String(page) },
          { headers: { "Content-Type": "application/json" }, timeout: 15000 }
        );
        jobs = res.data.jobs ?? [];
      } catch (err) {
        result.errors.push(`Jooble page ${page}: ${(err as Error).message}`);
        break;
      }
      if (jobs.length === 0) break;

      for (const job of jobs) {
        try {
          if (!titleRelevant(job.title, keywords)) continue;
          if (isNonGermanLocation(job.location ?? "")) continue; // Germany only
          if (isPartTimeJob(job.title, job.type ? [job.type] : [], job.snippet ?? "")) continue;
          const sourceRef = `jooble:${job.id ?? job.link}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) { await prisma.vacancy.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } }); result.vacanciesUpdated++; continue; }

          const region = normalizeRegion(job.location);
          const text = `${job.title} ${job.snippet ?? ""}`;
          const signal = detectSignal(text);
          const email = extractGenericEmail(job.snippet ?? "");
          const companyName = (job.company ?? "").trim() || "Unbekannt";

          let employer = await prisma.employer.findFirst({ where: { name: companyName, region } });
          if (!employer) {
            employer = await prisma.employer.create({
              data: { name: companyName, city: job.location || null, region, sponsorshipSignal: signal, genericEmail: email },
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
              source: "jooble",
              url: job.link || null,
              description: (job.snippet ?? "").slice(0, 5000) || null,
              employmentType: job.type || null,
              sourceRef,
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? job.link ?? null,
              postedAt: job.updated ? new Date(job.updated) : null,
              rawData: job as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`Jooble job: ${(err as Error).message}`);
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
