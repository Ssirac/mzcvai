/**
 * Source authority ranking — not all job boards are equally trustworthy for a
 * given listing. When the SAME job arrives from several sources (which JSearch,
 * a meta-aggregator over LinkedIn/Indeed/StepStone/company pages, makes routine),
 * the higher-ranked source wins: its link is more likely direct and live, and
 * its data cleaner. Used by cross-source de-duplication to pick the survivor.
 *
 * Higher number = more authoritative. Ranking rationale:
 *   • the employer's own career page / a direct apply link is the ground truth
 *   • Bundesagentur is the official German federal job register
 *   • visa-focused boards (Arbeitnow) are curated and reliable
 *   • aggregators (Adzuna, Jooble, JSearch) re-list others' data — lower trust,
 *     link may bounce through a portal or be stale
 *   • scraped/unknown sources are the last resort
 */

// Vacancy.source values are free-text and vary by connector:
//   "arbeitsagentur" | "bundesagentur" | "adzuna" | "jooble" | "arbeitnow" |
//   "jsearch" / "jsearch (LinkedIn)" | scraper ids (hotelcareer, gastrojobs…) |
//   "manual". Matching is done on normalized substrings so publisher suffixes
//   (e.g. "jsearch (Indeed)") still resolve.
const RANKS: Array<{ match: (s: string) => boolean; rank: number }> = [
  // "career" as a WHOLE word only — so "company-careers" / "career-page" score
  // top, but the job board "hotelcareer" (no word boundary) does NOT.
  { match: (s) => /(^|[^a-z])careers?([^a-z]|$)/.test(s) || s.includes("company") || s === "manual", rank: 100 },
  { match: (s) => s.includes("arbeitsagentur") || s.includes("bundesagentur"), rank: 90 },
  { match: (s) => s.includes("arbeitnow"), rank: 70 },
  // Direct-employer hospitality boards scraped from the source site.
  { match: (s) => s.includes("hotelcareer") || s.includes("yourfirm") || s.includes("gastrojobs") || s.includes("jobware") || s.includes("stellenanzeigen") || s.includes("absolventa") || s.includes("stellenonline"), rank: 55 },
  { match: (s) => s.includes("adzuna"), rank: 45 },
  { match: (s) => s.includes("jooble"), rank: 42 },
  // Meta-aggregator: broadest reach, lowest per-listing trust (re-lists everyone).
  { match: (s) => s.includes("jsearch") || s.includes("google"), rank: 40 },
  { match: (s) => s.includes("hokify"), rank: 38 },
];

const DEFAULT_RANK = 20; // unknown / other scraped sources

export function sourceQualityRank(source: string | null | undefined): number {
  const s = (source ?? "").toLowerCase().trim();
  if (!s) return DEFAULT_RANK;
  for (const r of RANKS) if (r.match(s)) return r.rank;
  return DEFAULT_RANK;
}
