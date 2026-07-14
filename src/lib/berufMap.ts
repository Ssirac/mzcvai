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
// German + English synonym families (NO Azerbaijani here — AZ input is handled by
// the AZ_TO_DE translation layer below, so German-`beruf` searches never emit
// Azerbaijani search slugs). Hotel/Gastro families are intentionally the richest,
// since that is MZ's core placement sector.
const SYNONYM_GROUPS: string[][] = [
  // ── Hotel & Gastronomie (core) ──────────────────────────────────────────────
  ["koch", "köchin", "jungkoch", "beikoch", "kochhilfe", "küchenhilfe", "küchenmitarbeiter",
   "küche", "commis", "commis de cuisine", "chef de partie", "demichef", "demi chef de partie",
   "sous chef", "souschef", "küchenchef", "chefkoch", "chef de cuisine", "gardemanger",
   "saucier", "cook", "linecook", "line cook"],
  ["service", "servicekraft", "servicemitarbeiter", "servicepersonal", "kellner", "kellnerin",
   "chef de rang", "commis de rang", "restaurantfachmann", "restaurantfachfrau",
   "restaurantmitarbeiter", "saalpersonal", "runner", "food and beverage", "f&b service",
   "waiter", "waitress", "servierkraft"],
  ["rezeption", "rezeptionist", "rezeptionistin", "empfang", "empfangsmitarbeiter",
   "front office", "front desk", "night audit", "guest service", "gästebetreuung",
   "hotelfachmann", "hotelfachfrau", "hotelfach", "hotelkaufmann", "reception", "receptionist"],
  ["bar", "barkeeper", "barmann", "barfrau", "bartender", "barmixer", "barchef", "barista",
   "mixologe", "barservice", "barkraft"],
  ["housekeeping", "zimmermädchen", "zimmermaedchen", "roomboy", "room attendant",
   "etagenservice", "etagenmädchen", "zimmerreinigung", "zimmerpflege", "hausdame",
   "executive housekeeper", "housekeeping supervisor"],
  // NOTE: "facility" removed — a "Facility Manager / Technischer Objektverwalter"
  // is a technical/management role, NOT a cleaning job, and must not match a
  // Reinigungskraft search.
  ["reinigung", "reinigungskraft", "gebäudereiniger", "gebaeudereiniger", "raumpflege",
   "raumpfleger", "unterhaltsreinigung", "glasreiniger", "cleaner", "cleaning"],
  ["spülkraft", "spuelkraft", "spüler", "spueler", "abwäscher", "abwaescher", "spülhilfe",
   "geschirrspüler", "dishwasher", "küchenreinigung"],
  ["catering", "bankett", "bankettmitarbeiter", "bankettservice", "veranstaltung", "event",
   "eventgastronomie", "partyservice"],
  ["konditor", "konditorin", "bäcker", "baecker", "bäckerin", "backwaren", "backhilfe",
   "patissier", "pâtissier", "confiseur", "konditorei"],
  ["metzger", "fleischer", "schlachter", "wurstwaren", "fleischerei", "metzgerei"],
  // ── Gesundheit & Pflege ─────────────────────────────────────────────────────
  ["pflege", "pflegekraft", "pflegehelfer", "pflegehilfskraft", "altenpfleger", "altenpflegerin",
   "krankenpfleger", "gesundheits- und krankenpfleger", "pflegefachkraft", "nurse", "care"],
  // ── Bau & Handwerk ──────────────────────────────────────────────────────────
  ["installateur", "sanitär", "sanitaer", "anlagenmechaniker", "shk", "heizung", "klempner",
   "rohrleitungsbauer", "gas wasser installateur", "sanitär heizung klima", "plumber"],
  ["elektrik", "elektriker", "elektroniker", "elektroinstallateur", "electrician", "electrical"],
  ["schweißer", "schweisser", "welder", "welding"],
  ["maurer", "bau", "bauarbeiter", "bauhelfer", "hochbau", "construction"],
  ["maler", "lackierer", "maler und lackierer", "painter"],
  ["tischler", "schreiner", "möbeltischler", "carpenter", "joiner"],
  ["schlosser", "metallbau", "metallbauer", "zerspanung", "zerspanungsmechaniker", "cnc"],
  // ── IT & Büro & Sonstige ────────────────────────────────────────────────────
  ["it", "software", "softwareentwickler", "entwickler", "developer", "programmierer",
   "programmer", "fachinformatiker", "engineer"],
  ["lager", "lagerarbeiter", "lagerhelfer", "lagerist", "kommissionierer", "staplerfahrer", "warehouse"],
  ["lkw-fahrer", "berufskraftfahrer", "kraftfahrer", "fahrer", "auslieferungsfahrer", "driver", "truck"],
  ["buchhaltung", "buchhalter", "accountant", "accounting"],
  ["vertrieb", "sales", "verkauf", "verkäufer", "verkäuferin"],
  ["friseur", "friseurin", "hairdresser", "kosmetik", "kosmetiker"],
  ["druck", "drucker", "druckerei", "polygrafie", "polygraf", "offsetdruck", "digitaldruck",
   "medientechnologe", "siebdruck", "buchbinder"],
  ["gärtner", "gaertner", "landwirt", "landwirtschaft", "gardener", "agriculture"],
];

/**
 * Azerbaijani occupation (and common ASCII transliteration) → canonical German
 * term. Candidates frequently enter their job in Azerbaijani; we translate it to
 * the German equivalent BEFORE synonym expansion, so search + matching run against
 * the German listings. Each value is a member of a SYNONYM_GROUP above, so a
 * translated seed expands to the full German/English family. AZ terms themselves
 * are never used as search slugs.
 */
const AZ_TO_DE: Record<string, string> = {
  // Hotel & Gastronomie
  "aşpaz": "koch", "aspaz": "koch", "aşbaz": "koch", "asbaz": "koch",
  "aşpaz köməkçisi": "küchenhilfe", "aspaz komekcisi": "küchenhilfe", "mətbəx işçisi": "küchenhilfe",
  "ofisiant": "kellner", "ofisant": "kellner", "qarson": "kellner",
  "resepşn": "rezeption", "resepsiyon": "rezeption", "resepşnist": "rezeption", "qəbul": "rezeption",
  "barmen": "barkeeper", "barista": "barista", "bufetçi": "barkeeper",
  "qabyuyan": "spülkraft", "qab yuyan": "spülkraft",
  "otaq xidmətçisi": "housekeeping", "otaq təmizləyicisi": "housekeeping",
  "xadimə": "reinigungskraft", "xadime": "reinigungskraft", "təmizlikçi": "reinigungskraft",
  "təmizlikci": "reinigungskraft", "təmizlik": "reinigung",
  "qənnadçı": "konditor", "qennadci": "konditor", "çörəkçi": "bäcker", "corekci": "bäcker",
  "qəssab": "metzger", "qessab": "metzger",
  // Pflege
  "tibb bacısı": "krankenpfleger", "tibb bacisi": "krankenpfleger", "baxıcı": "pflegehelfer", "baxici": "pflegehelfer",
  // Bau & Handwerk
  "santexnik": "installateur", "santexnika": "installateur",
  "elektrik": "elektriker", "elektrikçi": "elektriker",
  "qaynaqçı": "schweißer", "qaynaqci": "schweißer",
  "bənna": "maurer", "benna": "maurer", "inşaatçı": "bauarbeiter", "insaatci": "bauarbeiter",
  "rəngsaz": "maler", "rengsaz": "maler", "boyaçı": "maler",
  "dülgər": "tischler", "dulger": "tischler", "xarrat": "tischler",
  "çilingər": "schlosser", "cilinger": "schlosser",
  // Logistik & Sonstige
  "anbardar": "lagerist", "anbar işçisi": "lagerarbeiter",
  "sürücü": "fahrer", "surucu": "fahrer", "yük maşını sürücüsü": "berufskraftfahrer",
  "mühasib": "buchhalter", "muhasib": "buchhalter",
  "satıcı": "verkäufer", "satici": "verkäufer",
  "bağban": "gärtner", "bagban": "gärtner",
};

export function berufSearchKeywords(beruf: string): string[] {
  const lower = beruf.toLowerCase().trim();
  const tokens = lower.split(/[\s/,-]+/).filter((t) => t.length >= 3);
  const out = new Set<string>([beruf]);

  // Compound titles ("Geschäftsführer / Bauprojektmanager", "Koch und Service")
  // → add each meaningful part as its own keyword so they match independently.
  beruf
    .split(/\s*[/,;&]\s*|\s+und\s+|\s+oder\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4)
    .forEach((p) => out.add(p));

  // AZ → DE: translate an Azerbaijani beruf (whole string or any token) to its
  // German canonical term. These German seeds both become keywords and drive the
  // synonym-group expansion below, so an AZ input yields the full German family.
  const seeds = new Set<string>();
  if (AZ_TO_DE[lower]) seeds.add(AZ_TO_DE[lower]);
  for (const t of tokens) if (AZ_TO_DE[t]) seeds.add(AZ_TO_DE[t]);
  seeds.forEach((s) => out.add(s));

  // Tokens that make a synonym group relevant: the beruf's own tokens PLUS any
  // German seed translated from Azerbaijani.
  const probeTokens = tokens.concat(Array.from(seeds));

  for (const group of SYNONYM_GROUPS) {
    // A group is relevant only if a term truly belongs to the beruf — not just a
    // short substring (e.g. "it" inside "Restaurantleiter" must NOT pull the IT group).
    const hit = group.some((term) =>
      lower === term ||
      seeds.has(term) ||
      termIncludes(lower, term) ||
      probeTokens.some((t) => t === term || (term.length >= 4 && t.length >= 4 && (term.includes(t) || t.includes(term))))
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

// Generic words that appear across ALL occupations and must never, on their own,
// cause a match (e.g. "Mitarbeiter", "Allround"). Filtered out of token/keyword
// overlap so "Allround-Mitarbeiter" doesn't match every "…-Mitarbeiter" title.
const MATCH_STOPWORDS = new Set([
  "mitarbeiter", "mitarbeiterin", "mitarbeiter/in", "allround", "allrounder", "kraft", "fachkraft",
  "hilfskraft", "aushilfe", "helfer", "personal", "job", "jobs", "stelle", "stellenangebot",
  "vollzeit", "teilzeit", "team", "quereinsteiger", "quereinsteigerin", "worker", "staff",
  "sonstige", "sonstiges", "sucht", "gesucht", "und", "oder", "für", "der", "die", "das",
]);
const isStopword = (w: string) => MATCH_STOPWORDS.has(w.toLowerCase());

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

  // Synonym-group match: candidate family term appears in vacancy beruf/title.
  // Generic words (Mitarbeiter, Allround, …) are excluded so they can't match
  // across unrelated occupations.
  const candKeywords = berufSearchKeywords(candidateBeruf)
    .map((k) => k.toLowerCase())
    .filter((k) => k.length >= 3 && !isStopword(k));
  if (candKeywords.some((kw) => termIncludes(v, kw) || termIncludes(title, kw))) return true;

  // token overlap against vacancy beruf/title (stopwords excluded)
  const tokens = c.split(/[\s/,-]+/).filter((t) => t.length >= 3 && !isStopword(t));
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
  // Countries (DE / EN / local spellings)
  "österreich", "austria", "autriche",
  "schweiz", "switzerland", "suisse", "svizzera",
  "liechtenstein",
  "niederlande", "netherlands", "nederland", "holland",
  "belgien", "belgium", "belgique", "belgie", "belgië",
  "luxemburg", "luxembourg",
  "frankreich", "france",
  "italien", "italy", "italia",
  "spanien", "spain", "espana", "españa",
  "portugal",
  "polen", "poland", "polska",
  "tschechien", "czech", "czechia", "cesko", "česko",
  "slowakei", "slovakia", "slowenien", "slovenia",
  "ungarn", "hungary",
  "rumänien", "romania", "bulgarien", "bulgaria",
  "kroatien", "croatia", "serbien", "serbia",
  "griechenland", "greece",
  "dänemark", "denmark", "schweden", "sweden", "norwegen", "norway", "finnland", "finland",
  "irland", "ireland",
  "vereinigtes königreich", "großbritannien", "united kingdom", "england", "scotland", "wales",
  "türkei", "turkey", "türkiye", "turkiye",
  "usa", "united states", "kanada", "canada",
  "vereinigte arabische emirate", "united arab emirates", "katar", "qatar", "saudi",
  // Foreign cities
  "wien", "vienna", "graz", "salzburg", "linz", "innsbruck", "klagenfurt", "villach", "wels",
  "zürich", "zurich", "genf", "geneva", "genève", "geneve", "basel", "bern", "lausanne",
  "luzern", "lucerne", "winterthur", "st. gallen", "st gallen", "lugano", "zug",
  "vaduz",
  "amsterdam", "rotterdam", "den haag", "the hague", "utrecht", "eindhoven", "groningen",
  "brüssel", "brussels", "bruxelles", "antwerpen", "antwerp", "gent", "ghent", "liège", "liege", "lüttich",
  "warschau", "warsaw", "krakau", "krakow", "kraków", "danzig", "gdansk", "breslau", "wroclaw",
  "prag", "prague", "praha", "brünn", "brno",
  "budapest",
  "paris", "lyon", "marseille", "straßburg", "strasbourg",
  "mailand", "milano", "milan", "rom", "rome", "roma", "turin", "torino", "neapel",
  "bozen", "bolzano", "südtirol",
  "madrid", "barcelona",
  "lissabon", "lisbon", "lisboa", "porto",
  "london", "manchester", "dublin",
  "kopenhagen", "copenhagen", "stockholm", "oslo", "helsinki",
  "istanbul", "ankara", "izmir",
  "dubai", "abu dhabi", "doha", "riad", "riyadh",
  // Explicit foreign / EU-wide remote
  "remote - eu", "remote (eu)", "remote europe", "eu remote", "europaweit",
];

// Word-boundary matcher — avoids false positives where a foreign token is a
// substring of a German place name (e.g. "bern" inside "Bernau").
const NON_GERMAN_RE = new RegExp(
  "\\b(" + NON_GERMAN_LOCATIONS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "i"
);

export function isNonGermanLocation(location: string): boolean {
  return NON_GERMAN_RE.test((location ?? "").toLowerCase());
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
