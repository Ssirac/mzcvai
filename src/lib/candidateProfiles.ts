/**
 * Candidate occupation profiles — the FULL set of occupations a candidate can
 * credibly be matched to, derived from the whole CV instead of a single field:
 *
 *   1. desiredPosition (Arzu olunan vəzifə) — primary, drives scoring/seniority
 *   2. beruf (general occupation)
 *   3. every distinct job title from the CV's experience history
 *
 * Matching treats a vacancy as relevant when its title fits ANY profile, so a
 * Koch whose CV also shows Pizzabäcker/Küchenhilfe stations gets those jobs
 * too — while the strict occupation gate still keeps office/IT noise out.
 */

interface ExperienceRow {
  title?: unknown;
}

export interface ProfileSource {
  beruf: string | null;
  desiredPosition: string | null;
  // Prisma Json column: [{ company, title, from, to, description }]
  experience: unknown;
}

const MAX_PROFILES = 6;

export function candidateProfiles(c: ProfileSource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const v = raw.trim();
    if (v.length < 3) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  push(c.desiredPosition);
  push(c.beruf);
  const experience = Array.isArray(c.experience) ? (c.experience as ExperienceRow[]) : [];
  for (const row of experience) push(row?.title);

  return out.slice(0, MAX_PROFILES);
}
