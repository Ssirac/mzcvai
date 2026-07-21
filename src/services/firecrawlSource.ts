/**
 * Firecrawl job source — web-search ingestion of DIRECT-EMPLOYER job pages.
 *
 * Firecrawl handles JS rendering + anti-bot, so it reaches career pages the API
 * feeds and the brittle CSS scrapers miss. We deliberately target direct-employer
 * postings (not the gated big boards): those expose the company's own site and a
 * generic bewerbung@ address, which is exactly what makes a match actionable —
 * the same reason the Personio feed is high-value.
 *
 * OPT-IN + fail-soft: only runs when FIRECRAWL_API_KEY is set AND
 * FIRECRAWL_INGEST_ENABLED="true" (search costs credits). Any error degrades to a
 * logged, empty result — never throws into the ingest cycle.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { ApplyChannel, SponsorshipSignal } from "@prisma/client";
import { berufSearchKeywords, isPartTimeJob, isNonGermanLocation } from "@/lib/berufMap";
import { BLOCKED_HOSTS } from "@/lib/actionable";
import { firecrawlSearch, firecrawlAvailable } from "@/services/firecrawl";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

export function firecrawlIngestEnabled(): boolean {
  return firecrawlAvailable() && process.env.FIRECRAWL_INGEST_ENABLED === "true";
}

const RECRUITMENT_PREFIXES = ["bewerbung", "bewerbungen", "karriere", "jobs", "job", "recruiting", "recruitment", "personal", "hr", "career", "careers", "apply"];
const GENERAL_PREFIXES = ["info", "kontakt", "contact", "office", "mail", "team"];

function extractGenericEmail(text: string): string | null {
  const all = (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) => e.toLowerCase());
  const pick = (prefixes: string[]) =>
    all.find((email) => {
      const local = email.split("@")[0] ?? "";
      return prefixes.some((p) => local === p || local.startsWith(p));
    });
  return pick(RECRUITMENT_PREFIXES) ?? pick(GENERAL_PREFIXES) ?? null;
}

const EXPLICIT = ["visa", "visum", "sponsor", "relocation", "relocate", "work permit", "blue card", "blaue karte"];
const LIKELY = ["english", "englisch", "international", "we welcome", "fachkräfte", "quereinsteiger"];
function detectSignal(text: string): SponsorshipSignal {
  const l = text.toLowerCase();
  if (EXPLICIT.some((k) => l.includes(k))) return "YES";
  if (LIKELY.some((k) => l.includes(k))) return "LIKELY";
  return "UNKNOWN";
}

function normalizeRegion(text: string): string {
  const i = text.toLowerCase();
  if (/nordrhein|köln|koeln|düsseldorf|dortmund|essen|duisburg/.test(i)) return "NRW";
  if (/münchen|munich|bayern|nürnberg|augsburg/.test(i)) return "Bayern";
  if (/berlin/.test(i)) return "Berlin";
  if (/hamburg/.test(i)) return "Hamburg";
  if (/frankfurt|hessen|wiesbaden|kassel/.test(i)) return "Hessen";
  if (/stuttgart|baden|karlsruhe|mannheim|freiburg/.test(i)) return "Baden-Württemberg";
  if (/dresden|leipzig|sachsen/.test(i)) return "Sachsen";
  if (/hannover|niedersachsen|braunschweig/.test(i)) return "Niedersachsen";
  if (/bremen/.test(i)) return "Bremen";
  return "Deutschland";
}

// Guess the employer name from the posting title ("Koch (m/w/d) – Hotel Adler")
// then fall back to the site's registrable domain.
function guessCompany(title: string, url: string): string {
  const seps = title.split(/\s+[–\-|@]\s+|\bbei\b|\bim\b/i).map((s) => s.trim()).filter(Boolean);
  const tail = seps.length > 1 ? seps[seps.length - 1] : "";
  if (tail && tail.length >= 3 && tail.length <= 60 && !/m\/w\/d|vollzeit|teilzeit/i.test(tail)) return tail;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const core = host.replace(/^(karriere|jobs?|career|recruiting|stellen)\./, "").split(".")[0];
    return core.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || host;
  } catch {
    return "Unbekannt";
  }
}

function stripMd(md: string): string {
  return md.replace(/[#>*_`~\[\]()]/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
}

// Domains we DON'T want to ingest as "direct employers": the gated big boards /
// aggregators (also blocked for apply), and social/search noise.
const SKIP_DOMAINS = [...BLOCKED_HOSTS, "google.", "facebook.", "twitter.", "youtube.", "wikipedia.", "kununu."];

export async function ingestFirecrawl(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  if (!firecrawlIngestEnabled()) return result;

  const keywords = Array.from(new Set([opts.beruf, ...berufSearchKeywords(opts.beruf)]));
  const regionTerm = opts.region && opts.region !== "Deutschland" ? opts.region : "Deutschland";
  const limit = Math.min(20, Math.max(5, (opts.maxPages ?? 1) * 8));

  const run = await prisma.ingestionRun.create({
    data: { beruf: opts.beruf, region: opts.region, source: "firecrawl", status: "running" },
  });

  try {
    // Bias the query toward a real job posting with an application ("bewerbung"),
    // in Germany, for this occupation.
    const query = `${opts.beruf} Stellenangebot ${regionTerm} Deutschland bewerbung`;
    const items = await firecrawlSearch(query, { limit, scrape: true });
    if (!items) {
      result.errors.push("firecrawl search returned nothing (key/credits/error)");
    } else {
      for (const it of items) {
        try {
          const host = (() => { try { return new URL(it.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } })();
          if (!host || SKIP_DOMAINS.some((d) => host.includes(d))) continue;

          const text = `${it.title} ${it.description} ${stripMd(it.markdown)}`.trim();
          const relevant = keywords.some((kw) => {
            const toks = kw.toLowerCase().split(/[\s/,\-]+/).filter((t) => t.length >= 4);
            return toks.length > 0 && toks.some((t) => `${it.title} ${it.description}`.toLowerCase().includes(t));
          });
          if (!relevant) continue;
          if (isNonGermanLocation(text)) continue;
          if (isPartTimeJob(it.title, [], text)) continue;

          const sourceRef = `firecrawl:${createHash("sha1").update(it.url).digest("hex").slice(0, 16)}`;
          const existing = await prisma.vacancy.findUnique({ where: { sourceRef } });
          if (existing) {
            await prisma.vacancy.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
            result.vacanciesUpdated++;
            continue;
          }

          const region = normalizeRegion(text);
          const email = extractGenericEmail(it.markdown || it.description);
          const signal = detectSignal(text);
          const company = guessCompany(it.title, it.url);
          let website: string | null = null;
          try { const u = new URL(it.url); website = `${u.protocol}//${u.hostname}`; } catch { /* skip */ }

          let employer = await prisma.employer.findFirst({ where: { name: company, region } });
          if (!employer) {
            employer = await prisma.employer.create({
              data: { name: company || "Unbekannt", city: null, region, sponsorshipSignal: signal, genericEmail: email, website },
            });
            result.employersNew++;
          } else {
            const patch: Record<string, unknown> = {};
            if (signal !== "UNKNOWN" && employer.sponsorshipSignal === "UNKNOWN") patch.sponsorshipSignal = signal;
            if (email && !employer.genericEmail) patch.genericEmail = email;
            if (website && !employer.website) patch.website = website;
            if (Object.keys(patch).length) await prisma.employer.update({ where: { id: employer.id }, data: patch });
          }

          await prisma.vacancy.create({
            data: {
              employerId: employer.id,
              title: (it.title || "Stelle").slice(0, 200),
              beruf: opts.beruf,
              region,
              source: "firecrawl",
              url: it.url,
              description: stripMd(it.markdown).slice(0, 5000) || it.description.slice(0, 5000) || null,
              sourceRef,
              // Direct-employer email → apply by email; otherwise a form on the page.
              applyChannel: email ? ("EMAIL" as ApplyChannel) : ("FORM" as ApplyChannel),
              applyValue: email ?? it.url,
              postedAt: null,
              rawData: { url: it.url, title: it.title } as object,
            },
          });
          result.vacanciesNew++;
        } catch (err) {
          result.errors.push(`firecrawl ${it.url}: ${(err as Error).message}`);
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
