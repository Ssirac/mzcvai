import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { calculateCompanyScore, calculateFitScore } from "@/lib/scoring/companyScore";
import { berufSearchKeywords, seniorityLevel, berufMatches } from "@/lib/berufMap";
import { familyCompatibility } from "@/lib/occupationFamily";
import { isActionable } from "@/lib/actionable";
import { candidateProfiles } from "@/lib/candidateProfiles";

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
  const regions = candidate.regionPrefs.length > 0 ? candidate.regionPrefs : ["Deutschland"];
  const allGermany = regions.includes("Deutschland");

  // The FULL CV drives which jobs are matched: desired position (primary),
  // general beruf, plus every distinct job title from the CV's experience
  // history — a vacancy fitting ANY of those occupations qualifies. The
  // strict occupation gate below still rejects titles outside all of them.
  const profiles = candidateProfiles(candidate);

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
    take: 1000,
  });

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

    // Occupation gate: the vacancy TITLE must be in the candidate's line of
    // work — desired position, beruf, or one of the CV's experience titles.
    // Strict — an unclassifiable title with no keyword overlap is dropped (not
    // given a free pass), so office/IT/finance roles never reach a gastronomy
    // candidate on the strength of the polluted `beruf` field.
    const matchedProfile = profiles.find((p) => occupationRelevant(p, vacancy.title));
    if (!matchedProfile) {
      skipped.push(vacancy.id);
      continue;
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
