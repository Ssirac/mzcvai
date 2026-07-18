/**
 * Part-time / mini-job purge. The agency places full-time candidates only, so
 * these listings must never appear and must not linger in the DB. Ingest filters
 * them on the way in, the read queries hide any that slipped through, and this
 * runs on a schedule (hourly via the maintenance cron) to delete them outright.
 *
 * A vacancy is matched by a part-time title keyword OR an unambiguous mini-job
 * signal in the description (Minijob, 520-Euro, geringfügig, "nur Teilzeit").
 * Vacancies tied to a DISPATCHED outreach (sentAt set — covers SENT/OPENED/REPLIED/BOUNCED) are kept so application + reply history survives.
 * FK-safe: Outreach → Match → Vacancy.
 */

import { prisma } from "@/lib/prisma";
import { PART_TIME_TITLE_KEYWORDS, PART_TIME_HARD_KEYWORDS, isNonGermanLocation, isPartTimeJob } from "@/lib/berufMap";
import { normalizeEmployerName, normalizeJobTitle } from "@/lib/normalize";
import { sourceQualityRank } from "@/lib/sourceQuality";
import { occupationClusters } from "@/lib/occupationFamily";

/**
 * Cross-field match purge — the fast, standalone twin of the specialization gate
 * in matchCandidateToVacancies. That gate stops NEW wrong-field matches, but old
 * ones created before the fix only clear when a full re-match runs — and the
 * intraday re-match is coupled to a slow ingest (it drives browser scrapers), so
 * wrong matches can linger for a long time. This pass removes them directly, no
 * ingest: for every un-dispatched, un-judged match it compares the candidate's
 * CORE occupation cluster(s) (desired position + beruf) with the vacancy title's;
 * when both classify and DON'T overlap, the match is a wrong-specialization one
 * (logistics↔IT) and is deleted. SAFE: never touches a match with ANY outreach
 * (history) or any recruiter feedback (a hand-judged verdict).
 */
export async function pruneCrossFieldMatches(): Promise<{ crossFieldDeleted: number }> {
  const matches = await prisma.match.findMany({
    where: { outreach: { none: {} }, feedback: null },
    select: {
      id: true,
      candidate: { select: { desiredPosition: true, beruf: true } },
      vacancy: { select: { title: true } },
    },
  });

  // Cache clusters per distinct core string (many matches share a candidate).
  const coreCache = new Map<string, Set<string>>();
  const coreClustersFor = (dp: string | null, b: string | null): Set<string> => {
    const key = `${dp ?? ""}|${b ?? ""}`;
    let c = coreCache.get(key);
    if (!c) {
      c = new Set<string>();
      for (const t of [dp, b]) if (t && t.trim()) for (const cl of occupationClusters(t)) c.add(cl);
      coreCache.set(key, c);
    }
    return c;
  };

  const wrongIds: string[] = [];
  for (const m of matches) {
    const core = coreClustersFor(m.candidate.desiredPosition, m.candidate.beruf);
    if (core.size === 0) continue;                 // core unclassifiable → never prune (safety)
    const vac = occupationClusters(m.vacancy.title);
    if (vac.size === 0) continue;                  // title unclassifiable → leave to keyword gate
    if (!Array.from(vac).some((cl) => core.has(cl))) wrongIds.push(m.id);
  }

  let crossFieldDeleted = 0;
  if (wrongIds.length > 0) {
    const { count } = await prisma.match.deleteMany({ where: { id: { in: wrongIds }, outreach: { none: {} }, feedback: null } });
    crossFieldDeleted = count;
  }
  return { crossFieldDeleted };
}

// Remove dead and expired listings so candidates only ever see currently-open
// jobs. Two independent freshness tests (either one triggers removal):
//   • DEAD    — a source stopped re-listing it (lastSeenAt older than
//               VACANCY_STALE_DAYS): the position was filled or pulled.
//   • TOO OLD — the posting itself is past its shelf life (postedAt older than
//               VACANCY_MAX_AGE_DAYS), even if a stale aggregator still echoes it.
// NO foundAt guard: lastSeenAt always exists and is refreshed on every re-list,
// so a foundAt cutoff could ONLY ever delete listings the source still publishes
// (anything abandoned goes stale within VACANCY_STALE_DAYS anyway) — it silently
// purged live vacancies 30 days after discovery, the same class of bug the
// match-view foundAt guard had. Liveness = source re-listing + the dead sweep.
// Vacancies tied to a dispatched outreach (sentAt set) are always kept — deleting them would cascade away the application AND the employer reply history (this once silently ate replied threads).
export async function deleteExpiredVacancies(): Promise<{ expiredDeleted: number }> {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const staleDays = parseInt(process.env.VACANCY_STALE_DAYS ?? "10");
  // Same default as freshVacancyWhere() (matchFilters) — a lower default here
  // would hard-delete rows the view filter still wants to show.
  const maxAgeDays = parseInt(process.env.VACANCY_MAX_AGE_DAYS ?? "60");

  const staleCut = new Date(now - staleDays * day);   // not re-listed → dead
  const ageCut = new Date(now - maxAgeDays * day);    // posting too old

  const stale = await prisma.vacancy.findMany({
    where: {
      matches: { none: { outreach: { some: { sentAt: { not: null } } } } },
      OR: [
        { lastSeenAt: { lt: staleCut } },
        { postedAt: { lt: ageCut } },
      ],
    },
    select: { id: true, matches: { select: { id: true } } },
  });

  const ids = stale.map((v) => v.id);
  const matchIds = stale.flatMap((v) => v.matches.map((m) => m.id));

  let expiredDeleted = 0;
  if (ids.length > 0) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ids } } });
    expiredDeleted = count;
  }

  return { expiredDeleted };
}

// Germany-only guard: purge any vacancy whose employer/vacancy location names a
// place OUTSIDE Germany (Austria, Switzerland, etc.). The precise word-boundary
// check runs in JS — a raw DB `contains` would wrongly hit German names like
// "Bernau" (contains "bern"). Vacancies tied to a dispatched outreach (sentAt set) are kept.
export async function deleteNonGermanVacancies(): Promise<{ nonGermanDeleted: number }> {
  const vacancies = await prisma.vacancy.findMany({
    where: { matches: { none: { outreach: { some: { sentAt: { not: null } } } } } },
    select: {
      id: true,
      region: true,
      matches: { select: { id: true } },
      employer: { select: { city: true, region: true } },
    },
  });

  const foreign = vacancies.filter((v) =>
    isNonGermanLocation(`${v.employer?.city ?? ""} ${v.employer?.region ?? ""} ${v.region ?? ""}`)
  );

  const ids = foreign.map((v) => v.id);
  const matchIds = foreign.flatMap((v) => v.matches.map((m) => m.id));

  let nonGermanDeleted = 0;
  if (ids.length > 0) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ids } } });
    nonGermanDeleted = count;
  }

  return { nonGermanDeleted };
}

// One-shot purge run after every ingest: drop part-time/mini-job, non-German,
// and stale listings in a single call. The deletes cascade to Match + Outreach,
// so purged jobs also disappear from every candidate's matches immediately.
export async function runVacancyCleanup(): Promise<{ partTimeDeleted: number; nonGermanDeleted: number; expiredDeleted: number; duplicatesDeleted: number; matchesReassigned: number; crossFieldDeleted: number }> {
  const pt = await deletePartTimeVacancies();
  const ng = await deleteNonGermanVacancies();
  const ex = await deleteExpiredVacancies();
  const dup = await collapseCrossSourceDuplicates();
  const cf = await pruneCrossFieldMatches();
  return { ...pt, ...ng, ...ex, ...dup, ...cf };
}

/**
 * Cross-source de-duplication. The same job routinely arrives from several
 * sources (Bundesagentur + Adzuna + Jooble + JSearch…), each as its own Vacancy
 * row — that inflates a candidate's match list and count, and shows aggregator
 * links where a direct one exists. JSearch (a meta-aggregator) makes this the
 * common case, so this runs on every cleanup pass.
 *
 * Two vacancies are the same job when normalized title + employer + city match.
 * The survivor is the highest-authority source (see sourceQuality) — the direct
 * employer page / Bundesagentur beats an aggregator — tie-broken by freshest
 * lastSeenAt, then by having a real URL.
 *
 * Losers' matches are REASSIGNED to the survivor (not deleted), so a candidate
 * never loses a job — the duplicate copy is merged onto the surviving row. A
 * match is only dropped when the candidate already has one on the survivor (a
 * true duplicate). Loser vacancies, now match-free, are removed.
 *
 * Safety: only touches vacancies with NO dispatched outreach (same guard as the
 * other cleanup passes) — a job an application was already sent for is never
 * moved, preserving the send/reply history.
 */
export async function collapseCrossSourceDuplicates(): Promise<{ duplicatesDeleted: number; matchesReassigned: number }> {
  const vacancies = await prisma.vacancy.findMany({
    where: {
      status: "ACTIVE",
      // Protect sent history: never collapse a vacancy with a dispatched mail.
      matches: { none: { outreach: { some: { sentAt: { not: null } } } } },
    },
    select: {
      id: true, source: true, title: true, url: true, lastSeenAt: true,
      employer: { select: { name: true, city: true } },
      matches: { select: { id: true, candidateId: true } },
    },
  });

  // Group by dedup key. Weak keys (too-short title/employer) are skipped so we
  // never collapse unrelated rows on a thin match.
  const groups = new Map<string, typeof vacancies>();
  for (const v of vacancies) {
    const t = normalizeJobTitle(v.title);
    const e = normalizeEmployerName(v.employer?.name ?? "");
    if (t.length < 4 || e.length < 3) continue;
    const city = (v.employer?.city ?? "").toLowerCase().trim();
    const key = `${t}|${e}|${city}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(v);
  }

  const loserVacancyIds: string[] = [];
  const toDeleteMatchIds: string[] = [];
  // survivorId → list of loser match ids to repoint onto it.
  const reassignBySurvivor = new Map<string, string[]>();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Survivor: highest source authority, then freshest, then has a URL.
    const survivor = [...group].sort((a, b) => {
      const qa = sourceQualityRank(a.source), qb = sourceQualityRank(b.source);
      if (qa !== qb) return qb - qa;
      const la = a.lastSeenAt?.getTime() ?? 0, lb = b.lastSeenAt?.getTime() ?? 0;
      if (la !== lb) return lb - la;
      return (b.url ? 1 : 0) - (a.url ? 1 : 0);
    })[0];
    // Candidates already matched to the survivor — a loser match for one of them
    // is a genuine duplicate and gets dropped; everyone else is moved over. The
    // set grows as we claim candidates so two losers can't both move the same one
    // (which would violate the (candidate,vacancy) unique constraint).
    const claimed = new Set(survivor.matches.map((m) => m.candidateId));
    for (const v of group) {
      if (v.id === survivor.id) continue;
      loserVacancyIds.push(v.id);
      for (const m of v.matches) {
        if (claimed.has(m.candidateId)) {
          toDeleteMatchIds.push(m.id);
        } else {
          claimed.add(m.candidateId);
          (reassignBySurvivor.get(survivor.id) ?? reassignBySurvivor.set(survivor.id, []).get(survivor.id)!).push(m.id);
        }
      }
    }
  }

  let matchesReassigned = 0;
  let duplicatesDeleted = 0;
  if (loserVacancyIds.length > 0) {
    // 1. Move keeper matches onto the survivor (per survivor, distinct candidates).
    for (const [survivorId, matchIds] of reassignBySurvivor) {
      const { count } = await prisma.match.updateMany({
        where: { id: { in: matchIds } },
        data: { vacancyId: survivorId },
      });
      matchesReassigned += count;
    }
    // 2. Drop the true-duplicate matches (undispatched — safe to remove).
    if (toDeleteMatchIds.length > 0) {
      await prisma.outreach.deleteMany({ where: { matchId: { in: toDeleteMatchIds } } });
      await prisma.match.deleteMany({ where: { id: { in: toDeleteMatchIds } } });
    }
    // 3. Loser vacancies are now match-free → remove the duplicate rows.
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: loserVacancyIds } } });
    duplicatesDeleted = count;
  }

  return { duplicatesDeleted, matchesReassigned };
}

export async function deletePartTimeVacancies(): Promise<{ partTimeDeleted: number }> {
  const titleOr = PART_TIME_TITLE_KEYWORDS.map((kw) => ({
    title: { contains: kw, mode: "insensitive" as const },
  }));
  const descOr = PART_TIME_HARD_KEYWORDS.map((kw) => ({
    description: { contains: kw, mode: "insensitive" as const },
  }));

  // Candidate rows: anything mentioning a part-time/mini-job keyword. The keyword
  // is only a PREFILTER — the semantic classifier decides, so "Vollzeit oder
  // Teilzeit" (FULL_OR_PART) is KEPT and only genuine part-time-only / mini-jobs
  // are removed.
  const candidates = await prisma.vacancy.findMany({
    where: {
      OR: [...titleOr, ...descOr],
      matches: { none: { outreach: { some: { sentAt: { not: null } } } } },
    },
    select: { id: true, title: true, description: true, matches: { select: { id: true } } },
  });

  const ptVacancies = candidates.filter((v) => isPartTimeJob(v.title, undefined, v.description ?? undefined));
  const ptIds = ptVacancies.map((v) => v.id);
  const ptMatchIds = ptVacancies.flatMap((v) => v.matches.map((m) => m.id));

  let partTimeDeleted = 0;
  if (ptIds.length > 0) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: ptMatchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: ptMatchIds } } });
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ptIds } } });
    partTimeDeleted = count;
  }

  return { partTimeDeleted };
}
