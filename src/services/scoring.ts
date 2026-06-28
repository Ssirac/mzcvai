import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { calculateCompanyScore, calculateFitScore } from "@/lib/scoring/companyScore";
import { berufSearchKeywords, seniorityLevel } from "@/lib/berufMap";

const MATCH_THRESHOLD = 60; // minimum fitScore to create a Match record

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
  const regions = candidate.regionPrefs.length > 0 ? candidate.regionPrefs : ["Deutschland"];
  const allGermany = regions.includes("Deutschland");

  // The candidate's search profile = current occupation + the position they are
  // LOOKING FOR (desiredPosition). Both are searched so matches reflect what the
  // worker actually wants, across all job fields.
  const searchProfile = [candidate.beruf, candidate.desiredPosition]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(" / ");

  // Seniority window for matching:
  //  - maxLevel (ceiling) = what the candidate is QUALIFIED for (their beruf).
  //    We never match above this — no pushing a Fachkraft into management roles.
  //  - preferredLevel = the level they are AIMING for (desiredPosition). Often
  //    LOWER than the ceiling (e.g. a store manager willing to take entry-level
  //    hospitality work for a visa). It never raises the ceiling.
  //  - minLevel (floor) = a bit below the lowest of the two, so "a bit below" is
  //    included but we don't flood a manager with helper jobs.
  const maxLevel = seniorityLevel(candidate.beruf || candidate.desiredPosition || "");
  const preferredLevel = candidate.desiredPosition?.trim()
    ? seniorityLevel(candidate.desiredPosition)
    : maxLevel;
  const minLevel = Math.min(maxLevel, preferredLevel) - 1;

  // Build a flexible filter: match the profile or any of its synonyms against
  // the vacancy beruf OR title (case-insensitive), free-text, all sectors.
  const keywords = Array.from(
    new Set([searchProfile, ...berufSearchKeywords(searchProfile)].map((k) => k.trim()).filter(Boolean))
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
    take: 1000,
  });

  const created: string[] = [];
  const skipped: string[] = [];

  for (const vacancy of vacancies) {
    const fit = calculateFitScore({
      candidateBeruf: searchProfile,
      candidateMaxLevel: maxLevel,
      candidateMinLevel: minLevel,
      candidatePreferredLevel: preferredLevel,
      candidateRegions: candidate.regionPrefs,
      candidateLanguages: candidate.languages,
      candidateNeedsSponsorship: candidate.needsSponsorship,
      vacancyBeruf: vacancy.beruf,
      vacancyRegion: vacancy.region,
      vacancyTitle: vacancy.title,
      employerSponsorshipSignal: vacancy.employer.sponsorshipSignal,
    });

    if (fit.total < MATCH_THRESHOLD) {
      skipped.push(vacancy.id);
      continue;
    }

    await prisma.match.upsert({
      where: { candidateId_vacancyId: { candidateId, vacancyId: vacancy.id } },
      create: {
        candidateId,
        vacancyId: vacancy.id,
        employerId: vacancy.employerId,
        fitScore: fit.total,
        fitBreakdown: fit as object,
      },
      update: {
        fitScore: fit.total,
        fitBreakdown: fit as object,
      },
    });
    created.push(vacancy.id);
  }

  // Remove stale matches that no longer qualify (e.g. after criteria changes).
  // Keep any match that already has outreach activity (FK + business safety).
  const removed = await prisma.match.deleteMany({
    where: {
      candidateId,
      vacancyId: { notIn: created.length ? created : ["__none__"] },
      outreach: { none: {} },
    },
  });

  return { matched: created.length, skipped: skipped.length, removed: removed.count };
}
