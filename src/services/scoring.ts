import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { calculateCompanyScore, calculateFitScore } from "@/lib/scoring/companyScore";
import { berufSearchKeywords, seniorityLevel, berufMatches } from "@/lib/berufMap";
import { familyCompatibility, occupationClusters } from "@/lib/occupationFamily";
import { isActionable } from "@/lib/actionable";
import { candidateProfiles } from "@/lib/candidateProfiles";
import { getCandidateSuppression, suppressedByFeedback } from "@/services/matchFeedback";
import { prepareSemanticMatcher } from "@/services/semanticMatch";

// Is a vacancy TITLE actually in the candidate's line of work? Uses the vacancy
// title ONLY (its stored `beruf` is the polluted ingest search term). Occupation
// families decide when both classify; otherwise fall back to a strict title
// keyword/synonym match (with generic stopwords excluded). No family + no keyword
// overlap ⇒ NOT relevant — this closes the leak where an unclassifiable title
// (e.g. "Operational Excellence Coordinator") slipped through on the polluted
// beruf's fit score.
export function occupationRelevant(candidateProfile: string, vacancyTitle: string): boolean {
  const fam = familyCompatibility(candidateProfile, vacancyTitle);
  if (fam.decided) return fam.compatible;
  return berufMatches(candidateProfile, "", vacancyTitle); // title-only keyword match
}

// Minimum fitScore to create a Match. The vacancy pool is ALREADY restricted to
// occupation-relevant jobs by the search query, so a solid occupation + region
// match (≈57) should qualify even without a German level or a sponsorship
// signal — otherwise candidates with no German level set get zero matches.
const MATCH_THRESHOLD = 55;

// Recalculate and persist score for a single employer
export async function refreshEmployerScore(params: {
  employerId: string;
  targetBeruf: string;
  targetRegion: string;
}) {
  const employer = await prisma.employer.findUniqueOrThrow({
    where: { id: params.employerId },
    include: {
      vacancies: { select: { beruf: true, region: true, status: true } },
      signalLogs: { select: { eventType: true } },
    },
  });

  const breakdown = calculateCompanyScore({
    employer,
    vacancies: employer.vacancies,
    signalLogs: employer.signalLogs,
    targetBeruf: params.targetBeruf,
    targetRegion: params.targetRegion,
  });

  await prisma.employer.update({
    where: { id: params.employerId },
    data: {
      score: breakdown.total,
      scoreBreakdown: breakdown as object,
      scoreUpdatedAt: new Date(),
    },
  });

  return breakdown;
}

// Score all employers that have vacancies in beruf+region
export async function scoreEmployersForSearch(beruf: string, region: string) {
  const employers = await prisma.employer.findMany({
    where: {
      vacancies: {
        some: { beruf, status: "ACTIVE" },
      },
    },
    select: { id: true },
  });

  for (const { id } of employers) {
    await refreshEmployerScore({ employerId: id, targetBeruf: beruf, targetRegion: region });
  }

  return employers.length;
}

// Generate Match records for a candidate against all scored employers
export async function matchCandidateToVacancies(candidateId: string) {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
  // Business decision (operator, standing): EVERY candidate is searched across
  // ALL of Germany — the agency places nationwide, so a candidate's stored
  // region never restricts the job pool. regionPrefs is kept for display and
  // still feeds the fit-score's region component, but the vacancy query is
  // country-wide for everyone, now and for every future candidate.
  const regions = candidate.regionPrefs.length > 0 ? candidate.regionPrefs : ["Deutschland"];
  const allGermany = true;

  // FULL CV broadens the SEARCH (so we don't miss adjacent jobs); the gate below
  // narrows it back to the candidate's core field.
  const profiles = candidateProfiles(candidate);

  // SPECIALIZATION ANCHOR (the operator's core requirement: don't cross fields —
  // "logistikaya gedib IT kimi meyl göndərməyək"). The candidate's CORE
  // occupation is what the recruiter STATED: desired position + general beruf.
  // The CV's experience titles may widen matching, but only WITHIN the core
  // field's cluster(s) — an incidental line on a CV ("did some IT once") must
  // never pull a logistics candidate into IT roles. Cross-field noise is the #1
  // reply-rate killer.
  const coreClusters = new Set<string>();
  for (const core of [candidate.desiredPosition, candidate.beruf]) {
    if (core && core.trim()) for (const cl of occupationClusters(core)) coreClusters.add(cl);
  }
  // Profiles usable for the occupation gate: drop any secondary (experience)
  // profile that classifies into a DIFFERENT cluster than the core. Profiles the
  // family map can't classify stay (they can only match by keyword, low risk).
  // If the core itself is unclassifiable, keep everything — never zero out a
  // candidate whose stated occupation we simply don't recognise.
  const gateProfiles = coreClusters.size === 0
    ? profiles
    : profiles.filter((p) => {
        const pc = occupationClusters(p);
        return pc.size === 0 || Array.from(pc).some((cl) => coreClusters.has(cl));
      });

  // Build a flexible filter: match any profile or its synonyms against the
  // vacancy beruf OR title (case-insensitive), free-text, all sectors.
  const keywords = Array.from(
    new Set(
      profiles
        .flatMap((p) => [p, ...berufSearchKeywords(p)])
        .map((k) => k.trim())
        .filter(Boolean)
    )
  );
  // Short/ambiguous keywords (e.g. "IT") only match the vacancy beruf exactly to
  // avoid substring noise; longer keywords also search beruf + title substrings.
  const berufOr: Prisma.VacancyWhereInput[] = keywords.flatMap((kw) => {
    const clauses: Prisma.VacancyWhereInput[] = [{ beruf: { equals: kw, mode: "insensitive" } }];
    if (kw.length >= 4) {
      clauses.push({ beruf: { contains: kw, mode: "insensitive" } });
      clauses.push({ title: { contains: kw, mode: "insensitive" } });
    }
    return clauses;
  });

  const vacancies = await prisma.vacancy.findMany({
    where: {
      status: "ACTIVE",
      OR: berufOr,
      ...(allGermany ? {} : { region: { in: regions } }),
    },
    include: {
      employer: {
        include: { signalLogs: { select: { eventType: true } } },
      },
    },
    // Freshest-first, not an arbitrary slice: on saturated occupations the pool
    // exceeds `take`, and an UNORDERED take dropped exactly the newly-ingested
    // listings (e.g. the direct-employer Personio feeds) so they never reached a
    // candidate. Ordering by lastSeenAt keeps the most-recently-seen jobs — which
    // also matches the fresh-view the recruiter sees. Widened past 1000 to cover
    // busy hospitality berufs.
    orderBy: { lastSeenAt: "desc" },
    take: 1500,
  });

  // Feedback learning: prior BAD verdicts become suppression rules so matching
  // stops re-suggesting the same rejected pattern (employer won't sponsor / role
  // isn't right for this candidate). See services/matchFeedback.
  const suppression = await getCandidateSuppression(candidateId);

  // Semantic layer (opt-in, no-op unless SEMANTIC_MATCH_ENABLED + an embedding
  // key). Pre-embeds the candidate core + the pool titles once; gives a per-vacancy
  // cosine similarity used to (a) rescue in-field jobs the keyword gate would drop
  // and (b) add a small ranking bonus. Runs AFTER the hard cross-field gate below,
  // so it can never cross occupation fields. Fail-soft → null (unchanged behaviour).
  const sem = await prepareSemanticMatcher(
    { desiredPosition: candidate.desiredPosition, beruf: candidate.beruf },
    vacancies.map((v) => ({ id: v.id, title: v.title })),
  ).catch(() => null);
  const SEM_RESCUE = parseFloat(process.env.SEMANTIC_RESCUE_THRESHOLD ?? "0.6");
  const SEM_BONUS_MAX = parseInt(process.env.SEMANTIC_BONUS_MAX ?? "12");

  const created: string[] = [];
  const skipped: string[] = [];

  for (const vacancy of vacancies) {
    // Actionability gate: quality over quantity. Only keep jobs the candidate can
    // actually apply to — a real email, or a form on a reachable site. Drop the
    // ones with no contact / on a blocked host (StepStone, LinkedIn, Indeed…).
    const act = isActionable({
      applyChannel: vacancy.applyChannel,
      applyValue: vacancy.applyValue,
      url: vacancy.url,
      employerEmail: vacancy.employer.genericEmail,
    });
    if (!act.actionable) {
      skipped.push(vacancy.id);
      continue;
    }

    // Feedback suppression: skip employers/roles the recruiter already rejected
    // for this candidate (VISA → won't sponsor; SKILL_MISMATCH → wrong role).
    if (suppressedByFeedback(suppression, {
      employerId: vacancy.employerId,
      vacancyTitle: vacancy.title,
      candidateNeedsSponsorship: candidate.needsSponsorship,
    })) {
      skipped.push(vacancy.id);
      continue;
    }

    // HARD cross-field gate anchored on the CORE occupation: when BOTH the core
    // and the vacancy title classify into clusters, they MUST overlap. Decisive
    // block for logistics↔IT (and any other cross-field pair) — it fires even
    // when a keyword fallback or a stray CV title would otherwise sneak it in.
    if (coreClusters.size > 0) {
      const vacClusters = occupationClusters(vacancy.title);
      if (vacClusters.size > 0 && !Array.from(vacClusters).some((cl) => coreClusters.has(cl))) {
        skipped.push(vacancy.id);
        continue;
      }
    }

    // Occupation gate: the vacancy TITLE must be in the candidate's line of
    // work — desired position, beruf, or a SAME-CLUSTER CV experience title
    // (gateProfiles already dropped off-field CV titles). Strict — an
    // unclassifiable title with no keyword overlap is dropped (not given a free
    // pass), so office/IT/finance roles never reach a gastronomy candidate.
    let matchedProfile = gateProfiles.find((p) => occupationRelevant(p, vacancy.title));
    if (!matchedProfile) {
      // Semantic rescue: the title wording isn't in the keyword lists, but the
      // embedding says it's genuinely close to the candidate's core occupation.
      // The hard cross-field cluster gate already ran above, so this cannot cross
      // fields — it only recovers in-field jobs phrased in unfamiliar words.
      const sim = sem?.simFor(vacancy.id) ?? null;
      if (sim !== null && sim >= SEM_RESCUE) {
        matchedProfile = candidate.desiredPosition?.trim() || candidate.beruf?.trim() || gateProfiles[0];
      }
      if (!matchedProfile) {
        skipped.push(vacancy.id);
        continue;
      }
    }

    // Seniority window from the profile that actually matched, so a vacancy
    // matched via a CV experience title is levelled against THAT occupation.
    const profileLevel = seniorityLevel(matchedProfile);

    const fit = calculateFitScore({
      candidateBeruf: matchedProfile,
      candidateMaxLevel: profileLevel,
      candidateMinLevel: profileLevel - 1,
      candidatePreferredLevel: profileLevel,
      candidateRegions: candidate.regionPrefs,
      candidateLanguages: candidate.languages,
      candidateNeedsSponsorship: candidate.needsSponsorship,
      vacancyBeruf: vacancy.beruf,
      vacancyRegion: vacancy.region,
      vacancyTitle: vacancy.title,
      employerSponsorshipSignal: vacancy.employer.sponsorshipSignal,
      occupationRelevant: true, // gate above guarantees it
    });

    // Semantic ranking bonus: nudge genuinely-closer titles up within the same
    // field (a Koch job for a Koch candidate over a same-cluster Spülkraft one).
    // Zero when the semantic layer is off, so scores are identical to before.
    const sim = sem?.simFor(vacancy.id) ?? null;
    const semanticBonus = sim !== null ? Math.round(Math.max(0, sim) * SEM_BONUS_MAX) : 0;
    const totalWithSem = Math.min(100, fit.total + semanticBonus);

    if (totalWithSem < MATCH_THRESHOLD) {
      skipped.push(vacancy.id);
      continue;
    }

    const breakdown = semanticBonus > 0
      ? { ...fit, semanticSim: sim, semanticBonus, total: totalWithSem }
      : fit;

    await prisma.match.upsert({
      where: { candidateId_vacancyId: { candidateId, vacancyId: vacancy.id } },
      create: {
        candidateId,
        vacancyId: vacancy.id,
        employerId: vacancy.employerId,
        fitScore: totalWithSem,
        fitBreakdown: breakdown as object,
      },
      update: {
        fitScore: totalWithSem,
        fitBreakdown: breakdown as object,
      },
    });
    created.push(vacancy.id);
  }

  // Remove stale matches that no longer qualify (e.g. after criteria changes).
  // Keep any match that already has outreach activity (FK + business safety),
  // and any the recruiter has judged by hand (feedback set): deleting a BAD
  // match here let the next ingest recreate it clean — and auto-send could then
  // email an employer the recruiter had explicitly rejected.
  const removed = await prisma.match.deleteMany({
    where: {
      candidateId,
      vacancyId: { notIn: created.length ? created : ["__none__"] },
      outreach: { none: {} },
      feedback: null,
    },
  });

  return { matched: created.length, skipped: skipped.length, removed: removed.count };
}
