/**
 * Beruf (occupation) reference data.
 *
 * The system is sector-agnostic: `beruf` is a free-text string everywhere.
 * BERUF_LIST below is only a convenience list for the UI dropdown — users can
 * always type any custom occupation (manual entry) that is not in the list.
 */

export const BERUF_LIST = [
  // Hotel & Gastronomie
  "Housekeeping",
  "Koch",
  "Service",
  "Rezeption",
  "Reinigung",
  "Catering",
  "Bar / Barista",
  // Gesundheit & Pflege
  "Pflege",
  "Altenpflege",
  "Krankenpflege",
  "Arzt / Mediziner",
  "Medizinische Fachkraft",
  // Bau & Handwerk
  "Bauingenieur",
  "Maurer",
  "Maler / Lackierer",
  "Tischler / Schreiner",
  "Schweißer",
  "Installateur / Sanitär",
  "Elektrik",
  "KFZ-Mechaniker",
  // Industrie & Logistik
  "Lagerarbeiter",
  "Staplerfahrer",
  "LKW-Fahrer",
  "Produktionshelfer",
  "Maschinenbau",
  "Metallbau",
  // IT & Büro
  "IT",
  "Softwareentwickler",
  "Buchhaltung",
  "Verwaltung / Büro",
  "Vertrieb / Sales",
  "Marketing",
  "Kundenservice",
  // Bildung & Soziales
  "Erzieher",
  "Lehrer",
  "Sozialarbeiter",
  // Landwirtschaft & Sonstige
  "Landwirtschaft",
  "Friseur / Kosmetik",
  "Sicherheitsdienst",
  "Reinigungskraft Gebäude",
  "Sonstige",
] as const;

export type Beruf = string;

// MZ "field" → default Beruf suggestion
export const FIELD_TO_BERUF: Record<string, string> = {
  Hotel: "Service",
  Gastronomie: "Koch",
  Reinigung: "Reinigung",
  Büro: "Verwaltung / Büro",
  Bau: "Bauingenieur",
  Elektrik: "Elektrik",
  IT: "IT",
  Pflege: "Pflege",
  Housekeeping: "Housekeeping",
  Logistik: "Lagerarbeiter",
};

// Job title keywords → Beruf (checked against exp[].title)
const TITLE_KEYWORDS: { keywords: string[]; beruf: string }[] = [
  { keywords: ["housekeeping", "zimmer", "room", "etagen"], beruf: "Housekeeping" },
  { keywords: ["koch", "küche", "küchenchef", "chef de partie", "cook"], beruf: "Koch" },
  { keywords: ["service", "kellner", "waiter", "restaurant", "bankett"], beruf: "Service" },
  { keywords: ["rezeption", "front office", "hotel fachmann", "hotelfach", "reception"], beruf: "Rezeption" },
  { keywords: ["reinigung", "cleaning", "hauswirt", "facility"], beruf: "Reinigung" },
  { keywords: ["catering", "banket", "event", "veranstalt"], beruf: "Catering" },
  { keywords: ["pflege", "altenpflege", "krankenpflege", "nurse", "care"], beruf: "Pflege" },
  { keywords: ["bau", "civil", "ingenieur", "engineer", "architect"], beruf: "Bauingenieur" },
  { keywords: ["elektrik", "elektriker", "electrical"], beruf: "Elektrik" },
  { keywords: ["it", "software", "developer", "programmer", "entwickler"], beruf: "IT" },
  { keywords: ["lager", "logistik", "warehouse", "stapler", "forklift"], beruf: "Lagerarbeiter" },
  { keywords: ["fahrer", "driver", "lkw", "truck"], beruf: "LKW-Fahrer" },
  { keywords: ["schweiß", "welder", "welding"], beruf: "Schweißer" },
  { keywords: ["maler", "painter", "lackier"], beruf: "Maler / Lackierer" },
  { keywords: ["tischler", "schreiner", "carpenter"], beruf: "Tischler / Schreiner" },
];

export function guessBeruf(field: string, expTitles: string[]): string {
  for (const exp of expTitles) {
    const lower = exp.toLowerCase();
    for (const { keywords, beruf } of TITLE_KEYWORDS) {
      if (keywords.some((kw) => lower.includes(kw))) return beruf;
    }
  }
  return FIELD_TO_BERUF[field] ?? "Sonstige";
}

export const GERMAN_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "Muttersprache"] as const;

export const REGIONS_DE = [
  "Deutschland", // = bütün Almaniya / anywhere (default)
  "NRW",
  "Bayern",
  "Berlin",
  "Hamburg",
  "Hessen",
  "Baden-Württemberg",
  "Sachsen",
  "Niedersachsen",
  "Rheinland-Pfalz",
  "Brandenburg",
  "Schleswig-Holstein",
  "Thüringen",
  "Sachsen-Anhalt",
  "Mecklenburg-Vorpommern",
  "Saarland",
  "Bremen",
] as const;

/**
 * Synonym groups: each group lists terms (German + English) that refer to the
 * same occupation family. Used to expand a free-text beruf into search keywords
 * so ingestion and matching are robust to wording / language differences.
 */
const SYNONYM_GROUPS: string[][] = [
  ["housekeeping", "zimmermädchen", "roomboy", "etagenservice", "zimmerreinigung"],
  ["koch", "köchin", "küchenhilfe", "beikoch", "cook", "küche"],
  ["service", "servicekraft", "kellner", "restaurantfachmann", "waiter", "waitress"],
  ["rezeption", "rezeptionist", "empfang", "front office", "reception"],
  ["reinigung", "reinigungskraft", "gebäudereiniger", "raumpflege", "cleaner", "cleaning"],
  ["catering", "bankett", "bankettmitarbeiter"],
  ["pflege", "pflegekraft", "pflegehelfer", "altenpfleger", "krankenpfleger", "nurse", "care"],
  ["elektrik", "elektriker", "elektroniker", "electrician", "electrical"],
  ["it", "software", "softwareentwickler", "entwickler", "developer", "programmierer", "programmer", "fachinformatiker", "engineer"],
  ["lager", "lagerarbeiter", "lagerhelfer", "lagerist", "kommissionierer", "warehouse"],
  ["lkw-fahrer", "berufskraftfahrer", "kraftfahrer", "fahrer", "driver", "truck"],
  ["schweißer", "schweisser", "welder", "welding"],
  ["maurer", "bau", "bauarbeiter", "construction"],
  ["maler", "lackierer", "painter"],
  ["tischler", "schreiner", "carpenter"],
  ["buchhaltung", "buchhalter", "accountant", "accounting"],
  ["vertrieb", "sales", "verkauf", "verkäufer"],
  ["friseur", "hairdresser", "kosmetik"],
  ["druck", "drucker", "druckerei", "polygrafie", "polygraf", "offsetdruck", "digitaldruck", "medientechnologe", "siebdruck", "buchbinder"],
  ["schlosser", "metallbau", "metallbauer", "zerspanung", "cnc"],
  ["gärtner", "landwirt", "landwirtschaft", "gardener", "agriculture"],
];

export function berufSearchKeywords(beruf: string): string[] {
  const lower = beruf.toLowerCase();
  const tokens = lower.split(/[\s/,-]+/).filter((t) => t.length >= 3);
  const out = new Set<string>([beruf]);

  // Compound titles ("Geschäftsführer / Bauprojektmanager", "Koch und Service")
  // → add each meaningful part as its own keyword so they match independently.
  beruf
    .split(/\s*[/,;&]\s*|\s+und\s+|\s+oder\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4)
    .forEach((p) => out.add(p));

  for (const group of SYNONYM_GROUPS) {
    // A group is relevant only if a term truly belongs to the beruf — not just a
    // short substring (e.g. "it" inside "Restaurantleiter" must NOT pull the IT group).
    const hit = group.some((term) =>
      lower === term ||
      termIncludes(lower, term) ||
      tokens.some((t) => t === term || (term.length >= 4 && t.length >= 4 && (term.includes(t) || t.includes(term))))
    );
    if (hit) group.forEach((term) => out.add(term));
  }
  return Array.from(out);
}

/**
 * Flexible beruf comparison used by matching: case-insensitive, synonym-aware,
 * and tolerant of partial overlaps so free-text candidate berufs still match
 * vacancy berufs/titles across languages.
 */
// Keyword containment tuned for German compounds:
// - keywords ≥5 chars use substring match (so "druck" hits "Drucker"/"Offsetdruck",
//   "software" hits "Softwareentwickler") — long enough to avoid false positives.
// - shorter keywords (3–4) require a whole-word match (so "bau" doesn't hit "Bauer"
//   inside random words, and "it" — filtered out below — never matches "Mitarbeiter").
function termIncludes(haystack: string, needle: string): boolean {
  if (needle.length < 3) return false;
  if (needle.length >= 5) return haystack.includes(needle);
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zäöüß])${esc}([^a-zäöüß]|$)`, "i").test(haystack);
}

/**
 * Seniority level of an occupation/title (higher = more senior). Used so a
 * candidate is matched to jobs at THEIR level and a bit below — never above.
 *   0 = Helfer / Aushilfe / ungelernt / Praktikum (entry)
 *   1 = Fachkraft / regular skilled worker (DEFAULT)
 *   2 = Vorarbeiter / Schicht-/Teamleiter / Meister / Senior (lead)
 *   3 = Leitung / Manager / Geschäftsführer / Direktor (management)
 */
const LEVEL3_WORDS = [
  "geschäftsführer", "geschaeftsfuehrer", "geschäftsleitung", "manager", "managerin",
  "management", "director", "direktor", "direktorin", "vorstand", "inhaber", "prokurist",
  "führungskraft", "fuehrungskraft", "küchenchef", "kuechenchef", "chefkoch",
  "chef de cuisine", "head of", "betriebsleitung",
];
const LEVEL2_WORDS = [
  "senior", "vorarbeiter", "meister", "meisterin", "supervisor", "polier",
  "sous chef", "souschef", "sous-chef", "chef de partie", "obermonteur",
  "geprüfter", "gepruefter", "stellvertretende", "stellvertretender",
  "schichtführer", "schichtfuehrer", "teamlead", "team lead",
];
const LEVEL0_WORDS = [
  "helfer", "hilfskraft", "aushilfe", "ungelernt", "anlernkraft", "quereinsteiger",
  "praktikant", "praktikum", "trainee", "azubi", "auszubildende", "auszubildender",
  "ausbildung", "werkstudent", "minijob", "küchenhilfe", "kuechenhilfe",
  "servicehilfe", "reinigungshilfe", "bauhelfer", "lagerhelfer", "produktionshelfer",
];

export function seniorityLevel(text: string): number {
  const t = (text || "").toLowerCase();
  // Schicht-/Team-/Gruppenleiter are LEADS (level 2), not top management — check first
  if (/(schicht|team|gruppen)leit(er|erin|ung)/.test(t)) return 2;
  // Any "…leiter/…leitung" word ⇒ management (Bauleiter, Projektleitung) — but
  // exclude "begleiter/begleitung" (Reisebegleiter etc., which is NOT a leader).
  const isLeader = /\w*leit(er|erin|ung)\b/.test(t) && !/begleit/.test(t);
  if (isLeader || LEVEL3_WORDS.some((k) => t.includes(k))) return 3;
  if (LEVEL2_WORDS.some((k) => t.includes(k))) return 2;
  if (LEVEL0_WORDS.some((k) => t.includes(k))) return 0;
  return 1;
}

export function berufMatches(candidateBeruf: string, vacancyBeruf: string, vacancyTitle = ""): boolean {
  const c = candidateBeruf.trim().toLowerCase();
  const v = vacancyBeruf.trim().toLowerCase();
  const title = vacancyTitle.toLowerCase();
  if (!c) return false;
  if (c === v) return true;
  // Substring overlap, but only for needles ≥4 chars so a short vacancy beruf
  // like "IT" doesn't match inside unrelated words (e.g. "Restaurantle-IT-er").
  if (v.length >= 4 && c.includes(v)) return true;
  if (c.length >= 4 && v.includes(c)) return true;

  // Synonym-group match: candidate family term appears in vacancy beruf/title
  const candKeywords = berufSearchKeywords(candidateBeruf)
    .map((k) => k.toLowerCase())
    .filter((k) => k.length >= 3);
  if (candKeywords.some((kw) => termIncludes(v, kw) || termIncludes(title, kw))) return true;

  // token overlap against vacancy beruf/title
  const tokens = c.split(/[\s/,-]+/).filter((t) => t.length >= 3);
  return tokens.some((t) => termIncludes(v, t) || termIncludes(title, t));
}

// Keywords that indicate part-time or mini-job — we never ingest these.
export const PART_TIME_TITLE_KEYWORDS = [
  "teilzeit", "minijob", "mini-job", "geringfügig", "nebenjob",
  "part-time", "part time", "520-euro", "450-euro", "400-euro",
  "520 euro", "450 euro", "400 euro", "midijob", "midi-job",
];
const PART_TIME_TYPE_KEYWORDS = [
  "part_time", "part time", "parttime", "mini_job", "minijob",
  "teilzeit", "geringfügig",
];

// Unambiguous mini-job / marginal-employment signals. If any of these appears
// ANYWHERE (incl. the description), the job is part-time — there is no full-time
// version of a "Minijob" or a "520-Euro-Job". Bare "Teilzeit" is intentionally
// NOT here, because listings often say "Vollzeit oder Teilzeit" (full-time too).
export const PART_TIME_HARD_KEYWORDS = [
  "minijob", "mini-job", "mini job", "geringfügig", "geringfugig",
  "520-euro", "520 euro", "520€", "450-euro", "450 euro", "450€",
  "400-euro", "400 euro", "nebenjob", "midijob", "midi-job",
  "auf 520", "auf 538", "538-euro", "538 euro", "538€",
];

/**
 * Returns true if a job should be SKIPPED because it is part-time / mini-job.
 * @param title  Job title
 * @param types  Optional list of employment-type strings from the API (e.g. job_types, contract_time)
 * @param description  Optional job description text (scanned for HARD signals only)
 */
// European job boards (Arbeitnow, Jooble) can return jobs in neighbouring
// countries. The agency places only in Germany, so drop anything whose location
// clearly names a non-German country or city.
const NON_GERMAN_LOCATIONS = [
  "österreich", "austria", "wien", "vienna", "graz", "salzburg", "linz", "innsbruck",
  "schweiz", "switzerland", "suisse", "zürich", "zurich", "genf", "geneva", "basel", "bern", "lausanne",
  "niederlande", "netherlands", "nederland", "amsterdam", "rotterdam", "den haag", "utrecht", "eindhoven",
  "belgien", "belgium", "brüssel", "brussels", "antwerpen", "antwerp",
  "polen", "poland", "polska", "warschau", "warsaw", "krakau", "krakow",
  "luxemburg", "luxembourg", "frankreich", "france", "paris", "italien", "italy", "spanien", "spain",
  "dänemark", "denmark", "tschechien", "czech", "prag", "prague", "ungarn", "hungary", "budapest",
  "remote - eu", "united kingdom", "london", "ireland", "dublin",
];
export function isNonGermanLocation(location: string): boolean {
  const l = (location ?? "").toLowerCase();
  return NON_GERMAN_LOCATIONS.some((k) => l.includes(k));
}

export function isPartTimeJob(title: string, types?: string[], description?: string): boolean {
  const t = (title ?? "").toLowerCase();
  if (PART_TIME_TITLE_KEYWORDS.some((kw) => t.includes(kw))) return true;

  if (types && types.length > 0) {
    const combined = types.join(" ").toLowerCase();
    if (PART_TIME_TYPE_KEYWORDS.some((kw) => combined.includes(kw))) {
      // Only skip if there's NO full-time signal at all
      const hasFullTime = /full.?time|vollzeit|full_time/i.test(combined);
      if (!hasFullTime) return true;
    }
  }

  // Description: only unambiguous mini-job signals (a Minijob is never full-time).
  if (description) {
    const d = description.toLowerCase();
    if (PART_TIME_HARD_KEYWORDS.some((kw) => d.includes(kw))) return true;
    // "ausschließlich/nur in Teilzeit" = part-time only, no full-time option.
    if (/\b(nur|ausschlie(ß|ss)lich)\s+(in\s+)?teilzeit\b/.test(d)) return true;
  }

  return false;
}
