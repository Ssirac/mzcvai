/**
 * Feedback learning loop. When a recruiter marks a match BAD (with a structured
 * reason), matching should not keep re-suggesting the same mistake. This reads a
 * candidate's prior BAD verdicts and turns them into suppression rules applied
 * when NEW matches are scored (see scoring.matchCandidateToVacancies).
 *
 * The rules are deliberately conservative and explainable — no statistical
 * learning that could overfit on a handful of clicks:
 *
 *   • exact pairing        — a BAD match row persists (protected from the
 *     rematch delete) and is hidden from the list; it is never re-scored fresh.
 *   • VISA + employer      — "this employer won't sponsor them": skip that
 *     employer for a sponsorship-needing candidate.
 *   • SKILL_MISMATCH + title — "this role isn't right for them": skip vacancies
 *     whose normalized title matches, for this candidate.
 *
 * Other reasons (SALARY, LOCATION, LANGUAGE, OVERQUALIFIED, OTHER) only suppress
 * the exact pairing — generalizing them safely needs signals we don't extract
 * yet, so we don't guess.
 */

import { prisma } from "@/lib/prisma";
import { normalizeJobTitle } from "@/lib/normalize";

export interface CandidateSuppression {
  /** Employers the candidate marked BAD for VISA — skip if they need sponsorship. */
  visaEmployerIds: Set<string>;
  /** Normalized job titles marked BAD for SKILL_MISMATCH — skip these roles. */
  skillTitleKeys: Set<string>;
}

export async function getCandidateSuppression(candidateId: string): Promise<CandidateSuppression> {
  const bad = await prisma.match.findMany({
    where: { candidateId, feedback: "BAD" },
    select: {
      employerId: true,
      feedbackReason: true,
      vacancy: { select: { title: true } },
    },
  });

  const visaEmployerIds = new Set<string>();
  const skillTitleKeys = new Set<string>();
  for (const m of bad) {
    if (m.feedbackReason === "VISA") visaEmployerIds.add(m.employerId);
    if (m.feedbackReason === "SKILL_MISMATCH") {
      const key = normalizeJobTitle(m.vacancy?.title ?? "");
      if (key.length >= 4) skillTitleKeys.add(key);
    }
  }
  return { visaEmployerIds, skillTitleKeys };
}

/**
 * Should a NEW candidate↔vacancy match be suppressed by prior BAD feedback?
 * Returns a short reason string when it should be skipped, else null.
 */
export function suppressedByFeedback(
  sup: CandidateSuppression,
  params: { employerId: string; vacancyTitle: string; candidateNeedsSponsorship: boolean }
): "visa" | "skill" | null {
  if (params.candidateNeedsSponsorship && sup.visaEmployerIds.has(params.employerId)) return "visa";
  if (sup.skillTitleKeys.has(normalizeJobTitle(params.vacancyTitle))) return "skill";
  return null;
}
