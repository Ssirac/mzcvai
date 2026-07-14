import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { calculateCompanyScore, calculateFitScore } from "@/lib/scoring/companyScore";
import { berufSearchKeywords, seniorityLevel } from "@/lib/berufMap";
import { familyCompatibility } from "@/lib/occupationFamily";

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
  const regions = candidate.regionPrefs.length > 0 ? candidate.regionPrefs : ["Deutschland"];
  const allGermany = regions.includes("Deutschland");

  // Search profile drives which jobs are matched. If the recruiter filled in a
  // desired position (Arzu olunan vəzifə), match STRICTLY against that — the
  // candidate is looking for exactly that role. Only fall back to the general
  // occupation (beruf) when no desired position is given.
  const desired = candidate.desiredPosition?.trim();
  const searchProfile = desired || candidate.beruf || "";

  // Seniority window, derived from the effective search profile so the level
  // tracks what we're actually searching for.
  const profileLevel = seniorityLevel(searchProfile || candidate.beruf || "");
  const maxLevel = profileLevel;
  const preferredLevel = profileLevel;
  const minLevel = profileLevel - 1;

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
    // Occupation-family gate: the vacancy's TITLE (real) must be in the same
    // occupation family as the candidate. This stops cross-profession matches
    // that the polluted `beruf` field (= the ingest search term) would otherwise
    // score as perfect (e.g. a gastronomy candidate → "Technischer
    // Objektverwalter"). When either side is unclassifiable the gate abstains and
    // the normal fit score below decides, so unusual-but-valid roles still match.
    const fam = familyCompatibility(searchProfile, vacancy.title, vacancy.beruf);
    if (fam.decided && !fam.compatible) {
      skipped.push(vacancy.id);
      continue;
    }

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
