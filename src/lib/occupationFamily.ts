/**
 * Occupation FAMILY classification — the hard gate that stops cross-profession
 * matches (e.g. a gastronomy candidate being matched to a "Technischer
 * Objektverwalter" facility role).
 *
 * Why this exists: every ingest source stamps a vacancy's `beruf` with the
 * SEARCH term, not the job's real occupation, so `beruf` can't be trusted for
 * matching. The job TITLE, however, is real. This module maps a candidate's
 * occupation and a vacancy's title each to a set of coarse occupation families,
 * and matching requires the two sets to overlap.
 *
 * Families are deliberately broad buckets, not exact jobs. A term only counts
 * when it appears as a whole word (short terms) or as a clear substring (long
 * terms), so generic words never trigger a family. If a text matches no family
 * it is "unknown" — the caller then falls back to keyword matching rather than
 * hard-blocking, so an unusual-but-valid title is never silently dropped.
 */

// family → distinctive terms (German + English + common transliterations).
// Order doesn't matter; a text can belong to several families.
const FAMILIES: Record<string, string[]> = {
  gastro: [
    "koch", "köchin", "kochhilfe", "küchenhilfe", "küchenmitarbeiter", "küche", "beikoch",
    "commis", "chef de partie", "sous chef", "souschef", "küchenchef", "chefkoch", "gardemanger",
    "saucier", "cook", "service", "servicekraft", "servicemitarbeiter", "kellner", "kellnerin",
    "chef de rang", "commis de rang", "restaurantfachmann", "restaurantfachfrau",
    "restaurantmitarbeiter", "restaurant", "gastronomie", "systemgastronomie", "waiter", "waitress",
    "bar", "barkeeper", "barmann", "bartender", "barista", "catering", "bankett", "bankettmitarbeiter",
    "spülkraft", "spüler", "abwäscher", "geschirrspüler", "dishwasher", "konditor", "bäcker", "patissier",
    "metzger", "fleischer",
  ],
  hotel: [
    "hotel", "hotellerie", "gastgewerbe", "hospitality",
    "rezeption", "rezeptionist", "empfang", "empfangsmitarbeiter", "front office", "front desk",
    "night audit", "guest service", "gästebetreuung", "hotelfachmann", "hotelfachfrau", "hotelfach",
    "hotelkaufmann", "reception", "receptionist", "housekeeping", "zimmermädchen", "zimmermaedchen",
    "roomboy", "room attendant", "etagenservice", "hausdame", "zimmerreinigung",
  ],
  cleaning: [
    "reinigung", "reinigungskraft", "gebäudereiniger", "gebaeudereiniger", "raumpflege", "raumpfleger",
    "unterhaltsreinigung", "glasreiniger", "cleaner", "cleaning", "hauswirtschaft", "wäscherei",
    // housekeeping IS room cleaning — belongs here too, so a candidate who lists
    // "Reinigung" matches hotel housekeeping roles.
    "housekeeping", "zimmermädchen", "zimmermaedchen", "zimmerreinigung", "etagenservice", "hausdame",
  ],
  logistics: [
    "lager", "lagerarbeiter", "lagerhelfer", "lagerist", "kommissionierer", "kommissionierung",
    "staplerfahrer", "stapler", "warehouse", "logistik", "logistiker", "versand", "wareneingang",
    "fahrer", "kraftfahrer", "berufskraftfahrer", "lkw", "auslieferungsfahrer", "driver", "truck",
    "produktionshelfer", "produktion", "montage", "fertigung", "maschinenbediener", "packer", "verpackung",
  ],
  construction: [
    "bau", "bauarbeiter", "bauhelfer", "hochbau", "tiefbau", "maurer", "polier", "bauleiter",
    "baustelle", "bauprojekt", "bautechniker", "baukoordinator", "construction", "gerüstbauer",
    "betonbauer", "estrichleger", "trockenbau",
  ],
  trades: [
    "elektrik", "elektriker", "elektroniker", "elektroinstallateur", "electrician", "installateur",
    "sanitär", "sanitaer", "anlagenmechaniker", "shk", "heizung", "klempner", "schweißer", "schweisser",
    "welder", "maler", "lackierer", "painter", "tischler", "schreiner", "carpenter", "schlosser",
    "metallbau", "metallbauer", "zerspanung", "cnc", "mechaniker", "mechatroniker", "kfz",
  ],
  facility: [
    "objektverwalter", "objektbetreuer", "objektleiter", "hausmeister", "haustechnik", "haustechniker",
    "gebäudetechnik", "gebaeudetechnik", "facility", "facility management", "gebäudemanagement",
    "technischer objektverwalter", "immobilien", "property manager",
  ],
  care: [
    "pflege", "pflegekraft", "pflegehelfer", "pflegehilfskraft", "altenpfleger", "altenpflege",
    "krankenpfleger", "krankenpflege", "pflegefachkraft", "gesundheits", "nurse", "care", "betreuer",
    "betreuungskraft", "erzieher", "sozialarbeiter",
  ],
  office: [
    "verwaltung", "büro", "buero", "sachbearbeiter", "sekretär", "sekretariat", "assistenz",
    "buchhaltung", "buchhalter", "accountant", "kaufmann", "kauffrau", "kaufmännisch", "office",
    "empfangssekretär", "personalsachbearbeiter", "disponent",
    // NOTE: generic "Projektleiter/-manager/-koordinator" removed — a project
    // lead exists in every field (construction, IT, facility) and wrongly linked
    // office/sales candidates to technical roles. Field-specific project terms
    // (Bauprojekt…) live in their own family.
  ],
  sales: [
    "verkäufer", "verkäuferin", "verkauf", "vertrieb", "sales", "einzelhandel", "kasse", "kassierer",
    "filiale", "filialleiter", "filialleitung", "verkaufsberater", "kundenberater", "account manager",
    "retail", "shop",
  ],
  it: [
    "software", "softwareentwickler", "entwickler", "developer", "programmierer", "programmer",
    "fachinformatiker", "informatiker", "it-", "it administrator", "systemadministrator", "devops",
    "data scientist", "web developer",
  ],
  marketing: [
    "marketing", "online marketing", "social media", "social-media", "smm", "digitale medien",
    "content", "content creator", "mediengestalter", "grafikdesigner", "grafik", "designer", "seo",
    "sea", "kampagne", "öffentlichkeitsarbeit", "pr-", "redakteur", "moderator", "community manager",
    "influencer", "brand", "kommunikation", "werbung",
  ],
  security: [
    "sicherheit", "sicherheitsdienst", "sicherheitsmitarbeiter", "wachmann", "wachschutz",
    "objektschutz", "security", "türsteher", "pförtner", "werkschutz",
  ],
  beauty: [
    "friseur", "friseurin", "hairdresser", "kosmetik", "kosmetiker", "kosmetikerin", "nageldesigner",
    "barbier", "barber", "visagist", "make-up",
  ],
  agriculture: [
    "gärtner", "gaertner", "landwirt", "landwirtschaft", "gardener", "agriculture", "florist",
    "gartenbau", "landschaftsgärtner", "forstwirt",
  ],
};

// Word-boundary aware containment: long terms (>=5) match as substrings so
// German compounds work ("koch" would be too short, so it's whole-word; but
// "objektverwalter" matches inside "Technischer Objektverwalter"); short terms
// (3–4) must be whole words so "bau" doesn't fire inside "Umbau"-unrelated words.
function hit(haystack: string, term: string): boolean {
  if (term.length < 3) return false;
  if (term.length >= 5) return haystack.includes(term);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zäöüß])${esc}([^a-zäöüß]|$)`, "i").test(haystack);
}

// Families group into broader CLUSTERS. Two occupations are compatible when they
// share a cluster, so closely-related roles match (Koch↔Housekeeping↔Reinigung)
// while genuinely different fields don't (Gastronomie↔Facility, Vertrieb↔Bau).
const CLUSTER: Record<string, string> = {
  gastro: "hospitality", hotel: "hospitality", cleaning: "hospitality",
  construction: "technical", trades: "technical", facility: "technical",
  logistics: "logistics",
  office: "commercial", sales: "commercial", marketing: "commercial",
  care: "care",
  it: "it",
  security: "security",
  beauty: "beauty",
  agriculture: "agriculture",
};
const clustersOf = (fams: Set<string>): Set<string> => {
  const c = new Set<string>();
  Array.from(fams).forEach((f) => { if (CLUSTER[f]) c.add(CLUSTER[f]); });
  return c;
};

/** Occupation families a free-text occupation/title belongs to (may be empty). */
export function occupationFamilies(text: string): Set<string> {
  const t = (text || "").toLowerCase();
  const fams = new Set<string>();
  if (!t.trim()) return fams;
  for (const [family, terms] of Object.entries(FAMILIES)) {
    if (terms.some((term) => hit(t, term))) fams.add(family);
  }
  return fams;
}

/**
 * Decide whether a candidate's occupation is compatible with a vacancy.
 *  - If BOTH sides classify into families, they must overlap.
 *  - If EITHER side is unclassifiable, return null → the caller falls back to
 *    its normal keyword match (so unusual-but-valid roles aren't hard-dropped).
 */
// NOTE: the second vacancy arg is intentionally IGNORED. A vacancy's stored
// `beruf` is polluted (it's the ingest SEARCH term, not the real occupation), so
// classifying it would re-introduce the exact bug we're fixing — a facility job
// ingested under a gastronomy search would look like gastronomy. Only the TITLE
// (real) is used. The param is kept so callers can pass beruf harmlessly.
export function familyCompatibility(candidateProfile: string, vacancyTitle: string, _vacancyBeruf = ""):
  | { decided: true; compatible: boolean; candidate: string[]; vacancy: string[] }
  | { decided: false } {
  const cand = occupationFamilies(candidateProfile);
  const vac = occupationFamilies(vacancyTitle);
  if (cand.size === 0 || vac.size === 0) return { decided: false };
  // Compatible if they share a cluster (broader than an exact family), so
  // adjacent roles within hospitality / technical / commercial still match.
  const candClusters = clustersOf(cand);
  const vacClusters = clustersOf(vac);
  const compatible = Array.from(candClusters).some((c) => vacClusters.has(c));
  return { decided: true, compatible, candidate: Array.from(cand), vacancy: Array.from(vac) };
}
