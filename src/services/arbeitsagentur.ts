/**
 * Bundesagentur für Arbeit Job API client
 * Docs: https://jobsuche.api.bund.dev/
 *
 * Legal note: This is not legal advice.
 * Users must consult a German GDPR/UWG lawyer before scaling outreach operations.
 */

import axios, { AxiosError } from "axios";
import { prisma } from "@/lib/prisma";
import type { Employer, ApplyChannel } from "@prisma/client";
import { isPartTimeJob } from "@/lib/berufMap";

const BASE_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4";
const API_KEY = "jobboerse-jobsuche"; // public key for the BA job search API

// Beruf → Arbeitsagentur "was" keyword map (extend as needed)
export const BERUF_KEYWORDS: Record<string, string[]> = {
  Housekeeping: ["Housekeeping", "Zimmerfrau", "Roomattendant", "Etagen"],
  Koch: ["Koch", "Köchin", "Küchenchef", "Cuisine"],
  Service: ["Servicekraft", "Kellner", "Kellnerin", "Restaurantfachmann", "Restaurantfachfrau"],
  Rezeption: ["Rezeptionist", "Rezeptionistin", "Hotelfachmann", "Hotelfachfrau", "Front Office"],
  Reinigung: ["Reinigungskraft", "Hauswirtschaft", "Gebäudereiniger"],
  Catering: ["Catering", "Bankett", "Veranstaltung"],
};

export interface AAJob {
  refnr: string;
  titel: string;
  arbeitgeber: string;
  arbeitsort?: {
    ort?: string;
    region?: string;
    land?: string;
    plz?: string;
  };
  eintrittsdatum?: string;
  aktuelleVeroeffentlichungsdatum?: string;
  arbeitszeitmodelle?: string[];
  hauptDkz?: string;
}

export interface AAJobDetail extends AAJob {
  stellenbeschreibung?: string;
  arbeitgeberAdresse?: {
    strasse?: string;
    plz?: string;
    ort?: string;
    land?: string;
  };
  arbeitgeberHashId?: string;
  bewerbungInfos?: {
    onlineFormular?: string;
    email?: string;
    telefon?: string;
    bewerbungsKanalInfos?: Array<{ kanal?: string; wert?: string }>;
  };
}

interface SearchResult {
  maxErgebnisse: number;
  stellenangebote: AAJob[] | null;
}

// Exponential backoff retry
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  label = "request"
): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const axiosErr = err as AxiosError;
      lastError = err as Error;

      if (axiosErr.response?.status === 403) {
        console.warn(`[AA] ${label}: 403 Forbidden on attempt ${attempt}. Possible CAPTCHA or access restriction.`);
        // Don't retry 403 — it's a structural block, not a transient error
        throw new Error(`AA API returned 403. The endpoint may require different auth. Attempt: ${attempt}`);
      }

      if (axiosErr.response?.status === 429) {
        const delay = Math.min(1000 * 2 ** attempt, 30000);
        console.warn(`[AA] ${label}: Rate limited (429). Waiting ${delay}ms before retry ${attempt}/${maxAttempts}`);
        await sleep(delay);
        continue;
      }

      if (attempt < maxAttempts) {
        const delay = 1000 * 2 ** (attempt - 1);
        console.warn(`[AA] ${label}: Attempt ${attempt} failed (${axiosErr.message}). Retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildHeaders() {
  return {
    "X-API-Key": API_KEY,
    "Accept": "application/json",
    "User-Agent": "MZPersonal-CompanyFinder/1.0 (contact@mzpersonal.de)",
  };
}

// Search jobs for a given beruf + region
export async function searchJobs(params: {
  was: string;        // occupation keyword
  wo?: string;        // region/city
  umkreis?: number;   // radius in km
  page?: number;
  size?: number;
}): Promise<SearchResult> {
  const url = `${BASE_URL}/app/jobs`;
  const hasLocation = !!(params.wo && params.wo.trim());
  const searchParams: Record<string, string | number> = {
    was: params.was,
    angebotsart: 1,      // regular jobs
    page: params.page ?? 1,
    size: Math.min(params.size ?? 50, 100),
  };
  // Only send location + radius when a location is given; AA returns 400 if
  // umkreis is sent without wo (e.g. nationwide "Deutschland" search).
  if (hasLocation) {
    searchParams.wo = params.wo!.trim();
    searchParams.umkreis = params.umkreis ?? 50;
  }

  return withRetry(
    async () => {
      const res = await axios.get<SearchResult>(url, {
        params: searchParams,
        headers: buildHeaders(),
        timeout: 15000,
      });
      return res.data;
    },
    4,
    `searchJobs(${params.was}, ${params.wo})`
  );
}

// Fetch full detail for a single job by refnr
export async function fetchJobDetail(refnr: string): Promise<AAJobDetail | null> {
  const encoded = Buffer.from(refnr).toString("base64");
  const url = `${BASE_URL}/jobdetails/${encoded}`;

  try {
    return await withRetry(
      async () => {
        const res = await axios.get<AAJobDetail>(url, {
          headers: buildHeaders(),
          timeout: 15000,
        });
        return res.data;
      },
      3,
      `fetchJobDetail(${refnr})`
    );
  } catch (err) {
    console.error(`[AA] Could not fetch detail for refnr ${refnr}:`, (err as Error).message);
    return null; // graceful fallback — don't crash the whole run
  }
}

// Normalize AA region string to our canonical region name
function normalizeRegion(wo?: string, ort?: string): string {
  const input = (wo ?? ort ?? "").toLowerCase();
  if (input.includes("nrw") || input.includes("nordrhein")) return "NRW";
  if (input.includes("münchen") || input.includes("munich") || input.includes("bayern")) return "Bayern";
  if (input.includes("berlin")) return "Berlin";
  if (input.includes("hamburg")) return "Hamburg";
  if (input.includes("frankfurt") || input.includes("hessen")) return "Hessen";
  if (input.includes("köln") || input.includes("koeln")) return "NRW";
  if (input.includes("düsseldorf")) return "NRW";
  if (input.includes("stuttgart") || input.includes("baden")) return "Baden-Württemberg";
  return wo ?? ort ?? "Deutschland";
}

// Normalize apply channel from AA detail
function parseApplyChannel(detail: AAJobDetail): {
  channel: ApplyChannel;
  value: string | null;
} {
  const infos = detail.bewerbungInfos;
  if (!infos) return { channel: "UNKNOWN", value: null };

  if (infos.email) {
    // Only store generic email — personal HR emails filtered at higher layer
    return { channel: "EMAIL", value: infos.email };
  }
  if (infos.onlineFormular) {
    return { channel: "FORM", value: infos.onlineFormular };
  }
  if (infos.telefon) {
    return { channel: "PHONE", value: infos.telefon };
  }
  // Check bewerbungsKanalInfos
  for (const k of infos.bewerbungsKanalInfos ?? []) {
    if (k.kanal === "EMAIL" && k.wert) return { channel: "EMAIL", value: k.wert };
    if (k.kanal === "URL" && k.wert) return { channel: "FORM", value: k.wert };
  }
  return { channel: "UNKNOWN", value: null };
}

export interface IngestOptions {
  beruf: string;       // canonical beruf name (e.g. "Housekeeping")
  region: string;      // canonical region (e.g. "NRW")
  keywords?: string[]; // AA search keywords override
  maxPages?: number;
  pageSize?: number;
}

export interface IngestResult {
  vacanciesNew: number;
  vacanciesUpdated: number;
  employersNew: number;
  errors: string[];
}

/**
 * Main ingestion entry point.
 * Fetches Arbeitsagentur jobs for given beruf+region, upserts into DB.
 */
export async function ingestJobs(opts: IngestOptions): Promise<IngestResult> {
  const result: IngestResult = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] };
  const keywords = opts.keywords ?? BERUF_KEYWORDS[opts.beruf] ?? [opts.beruf];
  const maxPages = opts.maxPages ?? 3; // AA does a per-job detail fetch — keep modest
  const pageSize = opts.pageSize ?? 50;

  const run = await prisma.ingestionRun.create({
    data: {
      beruf: opts.beruf,
      region: opts.region,
      status: "running",
    },
  });

  try {
    for (const keyword of keywords) {
      let page = 1;
      let totalJobs = Infinity;

      // "Deutschland" → search the whole country (empty location)
      const wo = opts.region === "Deutschland" ? "" : opts.region;

      while (page <= maxPages && (page - 1) * pageSize < totalJobs) {
        let searchResult: SearchResult;
        try {
          searchResult = await searchJobs({ was: keyword, wo, page, size: pageSize });
        } catch (err) {
          const msg = `Search failed for keyword="${keyword}" region="${opts.region}" page=${page}: ${(err as Error).message}`;
          console.error(`[Ingest] ${msg}`);
          result.errors.push(msg);
          break; // stop pages for this keyword, move to next
        }

        totalJobs = searchResult.maxErgebnisse ?? 0;
        const jobs = searchResult.stellenangebote ?? [];

        if (jobs.length === 0) break;

        for (const job of jobs) {
          try {
            await processJob(job, opts.beruf, opts.region, result, keyword);
          } catch (err) {
            const msg = `Failed to process job refnr=${job.refnr}: ${(err as Error).message}`;
            console.error(`[Ingest] ${msg}`);
            result.errors.push(msg);
          }
          // Polite delay between detail fetches
          await sleep(150);
        }

        page++;
        await sleep(300); // polite delay between pages
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
      data: {
        status: "failed",
        errorMessage: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }

  return result;
}

// Relevance check: title/description should relate to the searched occupation.
// For known hospitality categories we use curated signal lists; for any other
// (free-text / all-sector) occupation we fall back to a generic token check
// against the search keyword so the system works across all job fields.
function isJobRelevant(job: AAJob, beruf: string, detail: AAJobDetail | null, keyword?: string): boolean {
  const titleLower = (job.titel ?? "").toLowerCase();
  const descLower = (detail?.stellenbeschreibung ?? "").toLowerCase();
  const text = titleLower + " " + descLower;

  const BERUF_SIGNALS: Record<string, string[]> = {
    Housekeeping: ["housekeeping", "zimmer", "room", "etagen", "reinigung", "hotel", "housekeepe"],
    Koch: ["koch", "küch", "cook", "cuisine", "gastro", "restaurant"],
    Service: ["service", "kellner", "waiter", "restaur", "gastro", "schankwirt"],
    Rezeption: ["rezept", "front office", "hotelfach", "reception", "hotel"],
    Reinigung: ["reinigung", "cleaning", "hauswirt", "facility", "gebäude"],
    Catering: ["catering", "bankett", "event", "veranstalt"],
  };

  const signals = BERUF_SIGNALS[beruf];
  if (signals) return signals.some((s) => text.includes(s));

  // Generic: accept if any significant token of the search keyword appears.
  const tokens = (keyword ?? beruf)
    .toLowerCase()
    .split(/[\s/,-]+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return true;
  return tokens.some((t) => text.includes(t));
}

// Extract sponsorship signal directly from job description (no website needed)
function extractSignalFromDescription(detail: AAJobDetail | null): {
  signal: "YES" | "LIKELY" | "UNKNOWN";
  website: string | null;
  email: string | null;
} {
  if (!detail?.stellenbeschreibung) return { signal: "UNKNOWN", website: null, email: null };

  const text = detail.stellenbeschreibung.toLowerCase();
  const rawText = detail.stellenbeschreibung;

  // Sponsorship signals
  const EXPLICIT_SIGNALS = ["visum", "sponsoring", "sponsorship", "relocation", "work permit", "drittstaaten", "nicht-eu", "ausländisch"];
  const LIKELY_SIGNALS = ["welcome", "international", "fachkräfte aus", "english", "englisch"];

  const signal =
    EXPLICIT_SIGNALS.some((s) => text.includes(s)) ? "YES" :
    LIKELY_SIGNALS.some((s) => text.includes(s)) ? "LIKELY" :
    "UNKNOWN";

  // Extract URLs
  const urlMatch = rawText.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+\.[a-zA-Z]{2,})/);
  const website = urlMatch ? `https://${urlMatch[1]}` : null;

  // Extract generic emails (not personal)
  const emailMatch = rawText.match(/\b(info|bewerbung|jobs|karriere|hr|post|kontakt)@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i);
  const email = emailMatch ? emailMatch[0] : null;

  return { signal, website, email };
}

async function processJob(
  job: AAJob,
  beruf: string,
  searchRegion: string,
  result: IngestResult,
  keyword?: string
): Promise<void> {
  // Check if vacancy already exists (sourceRef = refnr is unique)
  const existing = await prisma.vacancy.findUnique({ where: { sourceRef: job.refnr } });
  if (existing) {
    result.vacanciesUpdated++;
    return; // dedup — already ingested
  }

  // Fetch detail for apply channel info
  const detail = await fetchJobDetail(job.refnr);

  // Relevance filter — skip jobs unrelated to the occupation being searched
  if (!isJobRelevant(job, beruf, detail, keyword)) {
    return; // silently skip irrelevant matches from broad keyword search
  }

  // Skip part-time and mini-job listings — MZ only places full-time candidates
  if (isPartTimeJob(job.titel ?? "", job.arbeitszeitmodelle ?? [], detail?.stellenbeschreibung ?? "")) {
    return;
  }

  // Extract extra data from job description
  const descExtract = extractSignalFromDescription(detail);

  // Upsert employer
  const employerName = job.arbeitgeber ?? "Unknown";
  const city = job.arbeitsort?.ort ?? detail?.arbeitgeberAdresse?.ort ?? "";
  const region = normalizeRegion(searchRegion, job.arbeitsort?.region);
  const website = extractWebsiteFromDetail(detail) ?? descExtract.website;

  let employer: Employer;
  const employerLookup = await prisma.employer.findFirst({
    where: {
      name: employerName,
      ...(website ? { website } : { city }),
    },
  });

  if (employerLookup) {
    employer = employerLookup;
    // Update sponsorship signal if we found a better one from description
    if (descExtract.signal !== "UNKNOWN" && employerLookup.sponsorshipSignal === "UNKNOWN") {
      await prisma.employer.update({
        where: { id: employerLookup.id },
        data: {
          sponsorshipSignal: descExtract.signal,
          ...(descExtract.email && !employerLookup.genericEmail ? { genericEmail: descExtract.email } : {}),
          ...(website && !employerLookup.website ? { website } : {}),
        },
      });
    }
  } else {
    employer = await prisma.employer.create({
      data: {
        name: employerName,
        website,
        city,
        region,
        sourceRef: detail?.arbeitgeberHashId ?? null,
        sponsorshipSignal: descExtract.signal,
        genericEmail: descExtract.email ?? null,
      },
    });
    result.employersNew++;
  }

  // Parse apply channel — fall back to email from description
  const parsed = detail ? parseApplyChannel(detail) : { channel: "UNKNOWN" as ApplyChannel, value: null };
  const { channel, value } = parsed.channel !== "UNKNOWN"
    ? parsed
    : descExtract.email
      ? { channel: "EMAIL" as ApplyChannel, value: descExtract.email }
      : parsed;

  // Create vacancy
  await prisma.vacancy.create({
    data: {
      employerId: employer.id,
      title: job.titel ?? job.hauptDkz ?? "Unbekannte Stelle",
      beruf,
      region,
      source: "arbeitsagentur",
      // Keep the refnr raw — the slash must stay a literal "/" (encoding it to
      // %2F makes the public job-detail page return 404).
      url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${job.refnr}`,
      description: detail?.stellenbeschreibung ?? null,
      employmentType: job.arbeitszeitmodelle?.join(", ") ?? null,
      sourceRef: job.refnr,
      applyChannel: channel,
      applyValue: value,
      postedAt: job.aktuelleVeroeffentlichungsdatum ? new Date(job.aktuelleVeroeffentlichungsdatum) : null,
      rawData: job as object,
    },
  });

  result.vacanciesNew++;
}

function extractWebsiteFromDetail(detail: AAJobDetail | null): string | null {
  if (!detail) return null;
  const formUrl = detail.bewerbungInfos?.onlineFormular;
  if (!formUrl) return null;
  try {
    const u = new URL(formUrl);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return null;
  }
}
