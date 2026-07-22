/**
 * Company Score — sponsorship-dominant scoring (0–100)
 *
 * Weight distribution (total 100):
 *   Sponsorship signal          40  ← always dominant
 *   Active matching vacancy     20
 *   Direct apply channel        15
 *   Behavioral history          15  (starts at 0, fills from EmployerSignalLog)
 *   Context fit (region/size)   10
 */

import type { Employer, Vacancy, EmployerSignalLog, SponsorshipSignal } from "@prisma/client";
import { berufMatches, seniorityLevel } from "@/lib/berufMap";

export interface ScoreBreakdown {
  sponsorship: number;   // 0–40
  vacancy: number;       // 0–20
  channel: number;       // 0–15
  behavior: number;      // 0–15
  context: number;       // 0–10
  total: number;         // 0–100
  signals: string[];     // human-readable explanation
}

// ─── Sponsorship signal → score (40 max) ──────────────────────────────────────
function scoreSponsorshipSignal(signal: SponsorshipSignal): { score: number; signal: string } {
  switch (signal) {
    case "YES":
      return { score: 40, signal: "Explicit sponsorship/visa keyword found (+40)" };
    case "LIKELY":
      return { score: 28, signal: "Probable sponsorship signal (English posting or Fachkräfte aus Ausland) (+28)" };
    case "UNKNOWN":
      return { score: 10, signal: "No sponsorship signal yet — enrichment pending (+10)" };
    case "NO":
      return { score: 0, signal: "Employer signal indicates no non-EU hiring (+0)" };
  }
}

// ─── Vacancy presence → score (20 max) ───────────────────────────────────────
function scoreVacancy(
  vacancies: Pick<Vacancy, "beruf" | "region" | "status">[],
  targetBeruf: string,
  targetRegion: string
): { score: number; signal: string } {
  const active = vacancies.filter((v) => v.status === "ACTIVE");
  if (active.length === 0) return { score: 0, signal: "No active vacancies (+0)" };

  const exactMatch = active.filter(
    (v) => v.beruf === targetBeruf && v.region === targetRegion
  );
  if (exactMatch.length > 0) {
    return { score: 20, signal: `${exactMatch.length} active vacancy matches beruf+region exactly (+20)` };
  }

  const beruMatch = active.filter((v) => v.beruf === targetBeruf);
  if (beruMatch.length > 0) {
    return { score: 14, signal: `${beruMatch.length} active vacancy matches beruf (different region) (+14)` };
  }

  return { score: 8, signal: `${active.length} active vacancy (different beruf) (+8)` };
}

// ─── Apply channel → score (15 max) ──────────────────────────────────────────
function scoreApplyChannel(employer: Pick<Employer, "genericEmail" | "applyFormUrl" | "phone">): {
  score: number;
  signal: string;
} {
  if (employer.genericEmail || employer.applyFormUrl) {
    const channel = employer.genericEmail ? "email" : "online form";
    return { score: 15, signal: `Direct apply channel available (${channel}) (+15)` };
  }
  if (employer.phone) {
    return { score: 6, signal: "Only phone contact available — no direct email/form (+6)" };
  }
  return { score: 0, signal: "No known apply channel (+0)" };
}

// ─── Behavioral history → score (15 max) ─────────────────────────────────────
// Day 1 this is always 0 — fills as outreach happens
function scoreBehavior(signalLogs: Pick<EmployerSignalLog, "eventType">[]): {
  score: number;
  signal: string;
} {
  if (signalLogs.length === 0) {
    return { score: 0, signal: "No behavioral history yet (day 1 baseline) (+0)" };
  }

  let score = 0;
  const notes: string[] = [];

  const hiredCount = signalLogs.filter((l) => l.eventType === "CANDIDATE_HIRED").length;
  const repliedCount = signalLogs.filter((l) => l.eventType === "REPLY_RECEIVED").length;
  const bouncedCount = signalLogs.filter((l) => l.eventType === "OUTREACH_BOUNCED").length;

  if (hiredCount > 0) {
    score += Math.min(hiredCount * 5, 10);
    notes.push(`${hiredCount} past hire(s) (+${Math.min(hiredCount * 5, 10)})`);
  }
  if (repliedCount > 0) {
    score += Math.min(repliedCount * 2, 5);
    notes.push(`${repliedCount} prior reply/replies (+${Math.min(repliedCount * 2, 5)})`);
  }
  if (bouncedCount > 0) {
    score = Math.max(0, score - bouncedCount * 2);
    notes.push(`${bouncedCount} bounce(s) (−${bouncedCount * 2})`);
  }

  score = Math.min(score, 15);
  return {
    score,
    signal: notes.length > 0 ? notes.join("; ") : "Behavioral data present but neutral (+0)",
  };
}

// ─── Context fit → score (10 max) ────────────────────────────────────────────
function scoreContext(employer: Pick<Employer, "stars" | "rooms" | "region">, targetRegion: string): {
  score: number;
  signal: string;
} {
  let score = 0;
  const notes: string[] = [];

  if (employer.region === targetRegion) {
    score += 5;
    notes.push(`Region matches ${targetRegion} (+5)`);
  }

  // Larger hotels more likely to sponsor
  if (employer.rooms && employer.rooms >= 50) {
    score += 3;
    notes.push(`Hotel has ${employer.rooms} rooms — likely structured HR (+3)`);
  }

  // 4+ star hotels more likely to have international hiring pipelines
  if (employer.stars && employer.stars >= 4) {
    score += 2;
    notes.push(`${employer.stars}-star property (+2)`);
  }

  score = Math.min(score, 10);
  return {
    score,
    signal: notes.length > 0 ? notes.join("; ") : "Insufficient context data (+0)",
  };
}

// ─── Main scoring function ────────────────────────────────────────────────────
export function calculateCompanyScore(params: {
  employer: Pick<Employer, "genericEmail" | "applyFormUrl" | "phone" | "sponsorshipSignal" | "stars" | "rooms" | "region">;
  vacancies: Pick<Vacancy, "beruf" | "region" | "status">[];
  signalLogs: Pick<EmployerSignalLog, "eventType">[];
  targetBeruf: string;
  targetRegion: string;
}): ScoreBreakdown {
  const { employer, vacancies, signalLogs, targetBeruf, targetRegion } = params;

  const sponsorshipResult = scoreSponsorshipSignal(employer.sponsorshipSignal);
  const vacancyResult = scoreVacancy(vacancies, targetBeruf, targetRegion);
  const channelResult = scoreApplyChannel(employer);
  const behaviorResult = scoreBehavior(signalLogs);
  const contextResult = scoreContext(employer, targetRegion);

  const total =
    sponsorshipResult.score +
    vacancyResult.score +
    channelResult.score +
    behaviorResult.score +
    contextResult.score;

  return {
    sponsorship: sponsorshipResult.score,
    vacancy: vacancyResult.score,
    channel: channelResult.score,
    behavior: behaviorResult.score,
    context: contextResult.score,
    total: Math.min(total, 100),
    signals: [
      `SPONSORSHIP: ${sponsorshipResult.signal}`,
      `VACANCY: ${vacancyResult.signal}`,
      `CHANNEL: ${channelResult.signal}`,
      `BEHAVIOR: ${behaviorResult.signal}`,
      `CONTEXT: ${contextResult.signal}`,
    ],
  };
}

// ─── Candidate–Employer fit score (0–100) ────────────────────────────────────
export interface FitBreakdown {
  beruf: number;       // 0–40
  region: number;      // 0–25
  language: number;    // 0–20
  sponsorship: number; // 0–15
  level: number;       // vacancy seniority level (0–3)
  total: number;
}

export function calculateFitScore(params: {
  candidateBeruf: string;
  candidateMaxLevel: number;       // qualification ceiling (never match above this)
  candidateMinLevel: number;       // willing floor (a bit below the desired level)
  candidatePreferredLevel: number; // the level the candidate is actually aiming for
  candidateRegions: string[];
  candidateLanguages: string[];
  candidateNeedsSponsorship: boolean;
  vacancyBeruf: string;
  vacancyRegion: string;
  vacancyTitle?: string;
  employerSponsorshipSignal: SponsorshipSignal;
  // Whether the vacancy is in the candidate's line of work (decided by the caller
  // from the TITLE — the stored beruf is the polluted ingest search term). When
  // omitted, fall back to a title-only keyword match.
  occupationRelevant?: boolean;
}): FitBreakdown {
  const {
    candidateBeruf,
    candidateMaxLevel,
    candidateMinLevel,
    candidatePreferredLevel,
    candidateRegions,
    candidateLanguages,
    candidateNeedsSponsorship,
    vacancyRegion,
    vacancyTitle,
    employerSponsorshipSignal,
    occupationRelevant,
  } = params;

  // Seniority gate: match from the candidate's "willing floor" up to their
  // qualification ceiling — never above (too senior). Out-of-range ⇒ not a match.
  // Uses the TITLE only (the stored beruf is polluted).
  const vacLevel = seniorityLevel(vacancyTitle ?? "");
  const levelInRange = vacLevel <= candidateMaxLevel && vacLevel >= candidateMinLevel;
  if (!levelInRange) {
    return { beruf: 0, region: 0, language: 0, sponsorship: 0, level: vacLevel, total: 0 };
  }

  // Occupation score from real relevance (never from the polluted beruf field).
  const relevant = occupationRelevant ?? berufMatches(candidateBeruf, "", vacancyTitle ?? "");
  const beruf = relevant ? 32 : 0;

  // The agency places candidates NATIONWIDE, so location must not differentiate
  // the score — every German city is treated equally (full region points). A
  // candidate's stored regionPrefs no longer penalises jobs in other cities.
  // Set REGION_NATIONWIDE=false to restore location-based ranking (region points
  // only when the vacancy is in the candidate's regionPrefs).
  let region = 25;
  if (process.env.REGION_NATIONWIDE === "false") {
    region = (candidateRegions.length === 0 || candidateRegions.includes("Deutschland") || candidateRegions.includes(vacancyRegion)) ? 25 : 0;
  }

  // Graduated German-level score: higher level → more competitive, ranked higher
  const germanEntry = candidateLanguages.find((l) => l.toLowerCase().startsWith("de-"));
  const germanLevel = germanEntry ? germanEntry.split("-")[1]?.toUpperCase() ?? "" : "";
  const language =
    germanLevel === "C2" || germanLevel === "C1" ? 20 :
    germanLevel === "B2" ? 17 :
    germanLevel === "B1" ? 14 :
    germanLevel === "A2" ? 10 :
    germanLevel === "A1" ?  7 :
    candidateLanguages.some((l) => l.toLowerCase().startsWith("de")) ? 5 : 0;

  let sponsorship = 0;
  if (candidateNeedsSponsorship) {
    if (employerSponsorshipSignal === "YES") sponsorship = 15;
    else if (employerSponsorshipSignal === "LIKELY") sponsorship = 10;
    else sponsorship = 0;
  } else {
    // Candidate doesn't need sponsorship — no penalty, small bonus for employer
    // openness, but NOT for an employer that explicitly won't sponsor (signal
    // "NO"). The old ternary returned 10 in both arms (a dead branch), so the
    // "NO" case wrongly earned the same openness bonus as an open employer.
    sponsorship = employerSponsorshipSignal !== "NO" ? 10 : 0;
  }

  // Level bonus: prioritise jobs SLIGHTLY BELOW the preferred level (easier
  // to hire non-EU candidates into), then exact preferred, then further below.
  const levelDiff = candidatePreferredLevel - vacLevel; // positive = vacancy is lower
  const levelBonus =
    levelDiff === 1 ? 6 :  // one step below preferred — most realistic for visa hire
    levelDiff === 0 ? 3 :  // exact preferred level
    levelDiff >= 2 ? 1 :   // two+ steps below — still valid, ranked last
    0;                     // above preferred (within maxLevel) — no bonus
  const total = Math.min(beruf + region + language + sponsorship + levelBonus, 100);
  return { beruf, region, language, sponsorship, level: vacLevel, total };
}
