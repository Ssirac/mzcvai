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
import { asJobSource } from "@/services/scraper/runner";
import { SCRAPER_ADAPTERS } from "@/services/scraper/sites";
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
  // public.api.careerjet.net refuses ALL connections (ECONNREFUSED on 443) —
  // verified 2026-07-16 from two networks incl. Railway production. The public
  // search API appears discontinued; disabled so refresh cycles stop erroring.
  // Re-enable with CAREERJET_FORCE=true if the endpoint ever comes back.
  available: () => process.env.CAREERJET_FORCE === "true" && !!process.env.CAREERJET_AFFID,
  unavailableReason: "API-Endpunkt nicht erreichbar (ECONNREFUSED, vermutlich eingestellt) — geprüft 2026-07-16",
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

// Script-based (scraped) sources — no API. Each is a ScraperAdapter bridged into
// this registry via asJobSource(); the shared runner handles rate-limiting,
// robots, dead-listing removal, dedup and logging (see services/scraper/).
const scraperSources: JobSource[] = SCRAPER_ADAPTERS.map(asJobSource);

/**
 * Registry order follows the user's priority: hospitality platforms first,
 * then the big boards, then the live aggregators that already work.
 */
export const SOURCES: JobSource[] = [
  // Hospitality-focused — script-based scrapers (live)
  ...scraperSources,
  // HOGAPAGE: kein zugänglicher Listing-Endpunkt — /jobs/* liefert 404, Sitemaps
  // 404, /jobs/suche per robots.txt gesperrt (live geprüft, Bot-Schutz vermutet).
  placeholder("hogapage", "HOGAPAGE (Hotel & Gastronomie)", "hospitality", "Kein zugänglicher Listing-Endpunkt (/jobs/* → 404, /jobs/suche gesperrt)"),
  // yourcareergroup.de leitet die Jobsuche auf hotelcareer.de um (dieselbe YCG-
  // Plattform) — keine eigenen Daten, würde hotelcareer nur duplizieren.
  placeholder("yourcareergroup", "YourCareerGroup", "hospitality", "Leitet auf hotelcareer.de um — identische Quelle, kein separater Scraper"),
  // gastronomie-jobs.com: aus dieser Umgebung nicht erreichbar (Port 80/443
  // Timeout, AT-IP — vermutlich Geo-Sperre). Struktur nicht prüfbar → später aus
  // einem DACH-Netz verifizieren.
  placeholder("gastronomie-jobs", "Gastronomie-Jobs.com", "hospitality", "Nicht erreichbar (Timeout, vermutlich Geo-Sperre) — Struktur nicht prüfbar"),
  // rollingpin.de: React-SPA mit Build-gehashten CSS-Klassen (fragil), Keyword-
  // Suche API-getrieben (Payload nicht erfasst), Inhalte AT/CH-lastig (geringer
  // DE-Ertrag nach Germany-Filter). Aufgeschoben — Aufwand/Fragilität zu hoch.
  placeholder("rollingpin", "Rolling Pin (Luxus-Hospitality)", "hospitality", "React-SPA, gehashte Klassen + AT/CH-lastig — Scraper aufgeschoben"),
  // Big boards (placeholders — no free public API)
  placeholder("indeed", "Indeed Germany", "general", NEEDS_PARTNER),
  // StepStone: Akamai-Bot-Schutz — selbst /robots.txt liefert 403 Access Denied
  // (errors.edgesuite.net). Ohne Partner-API / Anti-Bot-Proxy nicht scrapebar.
  placeholder("stepstone", "StepStone", "general", "Akamai-Bot-Schutz (403) — Partner-API/Proxy erforderlich"),
  placeholder("linkedin", "LinkedIn Jobs", "general", NEEDS_PARTNER),
  placeholder("xing", "XING Jobs", "general", NEEDS_PARTNER),
  // Meinestadt: robots.txt ist erreichbar, aber die Job-Seiten selbst liefern
  // 403 Akamai (errors.edgesuite.net) — auch mit Browser-UA, www & jobs-Subdomain.
  placeholder("meinestadt", "meinestadt.de", "general", "Akamai-Bot-Schutz auf Job-Seiten (403) — Partner-API/Proxy erforderlich"),
  // Kimeta: alle Pfade liefern 503 (nginx) — via curl UND echtem Browser, aus
  // dieser Umgebung nicht erreichbar (vermutlich IP-/Geo-Sperre). Struktur nicht
  // prüfbar → später aus einem DACH-Netz erneut verifizieren.
  placeholder("kimeta", "Kimeta (Aggregator)", "general", "Nicht erreichbar (503 auf allen Pfaden) — Struktur nicht prüfbar"),
  placeholder("company-careers", "Firmen-Karriereseiten (direkt)", "general", "Pro Firma einzeln zu integrieren"),
  // Live modules (working now)
  bundesagentur,
  adzuna,
  arbeitnow,
  jooble,
  careerjet,
  jsearch,
];

export function getSource(id: string): JobSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function availableSources(): JobSource[] {
  return SOURCES.filter((s) => s.available());
}
