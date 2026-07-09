/**
 * Job-source registry — one module per platform.
 *
 * Each source implements the same `JobSource` interface, so adding or changing a
 * platform means touching only its module. `available()` reflects whether the
 * module is usable right now (e.g. its API key is configured). Platforms without
 * a legal public API are registered as placeholders (available=false) so the UI
 * lists them and a developer can plug in a real feed later without touching the
 * rest of the system.
 */

import { ingestJobs } from "@/services/arbeitsagentur";
import { ingestArbeitnow } from "@/services/arbeitnow";
import { ingestAdzuna } from "@/services/adzuna";
import { ingestJooble } from "@/services/jooble";
import { ingestCareerjet } from "@/services/careerjet";
import { ingestJSearch } from "@/services/jsearch";
import { ingestMeinestadt } from "@/services/meinestadt";
import type { IngestOptions, IngestResult } from "@/services/arbeitsagentur";

export interface JobSource {
  id: string;
  label: string;
  category: "general" | "hospitality";
  /** Is the module configured and usable right now? */
  available(): boolean;
  /** Why it's not available yet (shown in the UI) */
  unavailableReason?: string;
  ingest(opts: IngestOptions): Promise<IngestResult>;
}

const emptyResult = (msg: string): IngestResult => ({ vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [msg] });

// Placeholder module for a platform with no legal public API yet.
function placeholder(id: string, label: string, category: JobSource["category"], reason: string): JobSource {
  return {
    id, label, category,
    available: () => false,
    unavailableReason: reason,
    ingest: async () => emptyResult(`${label}: ${reason}`),
  };
}

const NEEDS_PARTNER = "Offizielle Partner-API / Datenfeed erforderlich (kein freies öffentliches API)";

// ── Live modules (legal APIs) ────────────────────────────────────────────────
const bundesagentur: JobSource = {
  id: "bundesagentur",
  label: "Bundesagentur für Arbeit",
  category: "general",
  available: () => true,
  ingest: (o) => ingestJobs(o),
};

const adzuna: JobSource = {
  id: "adzuna",
  label: "Adzuna (alle Portale + Firmen)",
  category: "general",
  available: () => !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
  unavailableReason: "ADZUNA_APP_ID / ADZUNA_APP_KEY erforderlich",
  ingest: (o) => ingestAdzuna(o),
};

const arbeitnow: JobSource = {
  id: "arbeitnow",
  label: "Arbeitnow (Visa-Sponsoring)",
  category: "general",
  available: () => true,
  ingest: (o) => ingestArbeitnow(o),
};

const jooble: JobSource = {
  id: "jooble",
  label: "Jooble (Aggregator)",
  category: "general",
  available: () => !!process.env.JOOBLE_API_KEY,
  unavailableReason: "JOOBLE_API_KEY erforderlich",
  ingest: (o) => ingestJooble(o),
};

const careerjet: JobSource = {
  id: "careerjet",
  label: "Careerjet (Aggregator — inkl. LinkedIn/Indeed-Crossposts)",
  category: "general",
  available: () => !!process.env.CAREERJET_AFFID,
  unavailableReason: "CAREERJET_AFFID erforderlich (kostenlos)",
  ingest: (o) => ingestCareerjet(o),
};

const jsearch: JobSource = {
  id: "jsearch",
  label: "JSearch / Google for Jobs (inkl. LinkedIn, Indeed, StepStone)",
  category: "general",
  available: () => !!process.env.RAPIDAPI_KEY,
  unavailableReason: "RAPIDAPI_KEY erforderlich (kostenloser Plan verfügbar)",
  ingest: (o) => ingestJSearch(o),
};

const meinestadt: JobSource = {
  id: "meinestadt",
  label: "meineStadt (Beta — Scraper)",
  category: "general",
  available: () => process.env.MEINESTADT_ENABLED === "true",
  unavailableReason: "MEINESTADT_ENABLED=true erforderlich (Beta-Scraper, keine offizielle API)",
  ingest: (o) => ingestMeinestadt(o),
};

/**
 * Registry order follows the user's priority: hospitality platforms first,
 * then the big boards, then the live aggregators that already work.
 */
export const SOURCES: JobSource[] = [
  // Hospitality-focused (placeholders — need partner access)
  placeholder("hogapage", "HOGAPAGE (Hotel & Gastronomie)", "hospitality", NEEDS_PARTNER),
  placeholder("hotelcareer", "Hotelcareer", "hospitality", NEEDS_PARTNER),
  // Big boards (placeholders — no free public API)
  placeholder("indeed", "Indeed Germany", "general", NEEDS_PARTNER),
  placeholder("stepstone", "StepStone", "general", NEEDS_PARTNER),
  placeholder("linkedin", "LinkedIn Jobs", "general", NEEDS_PARTNER),
  placeholder("xing", "XING Jobs", "general", NEEDS_PARTNER),
  placeholder("company-careers", "Firmen-Karriereseiten (direkt)", "general", "Pro Firma einzeln zu integrieren"),
  // Live modules (working now)
  bundesagentur,
  adzuna,
  arbeitnow,
  jooble,
  careerjet,
  jsearch,
  meinestadt,
];

export function getSource(id: string): JobSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function availableSources(): JobSource[] {
  return SOURCES.filter((s) => s.available());
}
