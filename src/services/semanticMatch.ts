/**
 * Semantic matching layer (opt-in) — adds embedding-based understanding on top of
 * the deterministic keyword/cluster matcher, addressing its two biggest limits:
 *   1. jobs whose TITLE wording isn't in the hand-maintained keyword lists but are
 *      genuinely in the candidate's field (rescued instead of silently dropped);
 *   2. no within-field ranking signal (a small score bonus by semantic closeness).
 *
 * It NEVER crosses occupation fields: it only runs AFTER the hard cross-field
 * cluster gate in scoring.ts, so a logistics candidate can't be pulled into IT.
 *
 * Fully gated: returns null (a no-op) unless SEMANTIC_MATCH_ENABLED==="true" AND
 * an embedding provider key is set — so the deterministic path is unchanged by
 * default. See src/lib/embeddings.ts.
 */

import { embedTexts, embeddingsAvailable, cosine } from "@/lib/embeddings";

export interface SemanticMatcher {
  /** Cosine similarity (0..1) of a vacancy's title to the candidate core, or null. */
  simFor(vacancyId: string): number | null;
}

interface CandidateCore { desiredPosition: string | null; beruf: string | null }
interface VacancyLite { id: string; title: string | null }

/**
 * Pre-embed the candidate core occupation + all candidate-pool vacancy titles
 * (cached), returning a fast per-vacancy similarity lookup. One provider call for
 * the candidate core + one batched call for any not-yet-cached titles.
 */
export async function prepareSemanticMatcher(
  candidate: CandidateCore,
  vacancies: VacancyLite[],
): Promise<SemanticMatcher | null> {
  if (process.env.SEMANTIC_MATCH_ENABLED !== "true" || !embeddingsAvailable()) return null;

  const coreText = [candidate.desiredPosition, candidate.beruf]
    .map((s) => (s || "").trim()).filter(Boolean).join(" ").trim();
  if (!coreText) return null;

  const titles = vacancies.map((v) => v.title || "");
  let vectors: (number[] | null)[];
  try {
    vectors = await embedTexts([coreText, ...titles]);
  } catch {
    return null;
  }
  const coreVec = vectors[0];
  if (!coreVec) return null;

  const simByVac = new Map<string, number>();
  for (let i = 0; i < vacancies.length; i++) {
    const vec = vectors[i + 1];
    if (vec) simByVac.set(vacancies[i].id, cosine(coreVec, vec));
  }

  return { simFor: (id) => (simByVac.has(id) ? simByVac.get(id)! : null) };
}
