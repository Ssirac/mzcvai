import { PART_TIME_TITLE_KEYWORDS, PART_TIME_HARD_KEYWORDS } from "@/lib/berufMap";

/**
 * The single definition of a "fresh, showable" vacancy — used by the matches
 * view AND the candidate-list match counter, so both always report the same
 * number. Three expiry guards, applied at view time (not just by the background
 * sweep) so an expired listing never reaches the candidate:
 *   • foundAt    — first discovered within VACANCY_FOUND_MAX_DAYS (default 30)
 *   • lastSeenAt — the source STILL re-lists it (stale ⇒ pulled/filled)
 *   • postedAt   — the posting itself isn't past its shelf life
 * Plus: never show part-time / mini-job listings, even if some slipped past the
 * ingest filter — full-time only.
 */
export function freshVacancyWhere() {
  const day = 24 * 60 * 60 * 1000;
  const expiryCutoff = new Date(Date.now() - parseInt(process.env.VACANCY_FOUND_MAX_DAYS ?? "30") * day);
  const staleCutoff = new Date(Date.now() - parseInt(process.env.VACANCY_STALE_DAYS ?? "10") * day);
  const postedCutoff = new Date(Date.now() - parseInt(process.env.VACANCY_MAX_AGE_DAYS ?? "30") * day);

  const partTimeOr = [
    ...PART_TIME_TITLE_KEYWORDS.map((kw) => ({ title: { contains: kw, mode: "insensitive" as const } })),
    ...PART_TIME_HARD_KEYWORDS.map((kw) => ({ description: { contains: kw, mode: "insensitive" as const } })),
  ];

  return {
    status: "ACTIVE" as const,
    foundAt: { gte: expiryCutoff },
    lastSeenAt: { gte: staleCutoff },
    // Hide old postings; rows without a postedAt (null) are kept.
    NOT: { OR: [...partTimeOr, { postedAt: { lt: postedCutoff } }] },
  };
}
