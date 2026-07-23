import { describe, it, expect, afterEach } from "vitest";
import type { SponsorshipSignal } from "@prisma/client";
import { calculateFitScore } from "./companyScore";

type Params = Parameters<typeof calculateFitScore>[0];

// A concrete in-range base case. Title "Koch" has no seniority keyword →
// seniorityLevel 1. Components under this base: beruf 32 (relevant), region 25
// (nationwide default), language 14 (de-B1), sponsorship 15 (needs + YES),
// levelBonus 3 (preferred 1 − vacLevel 1 = 0) → total 89.
function base(overrides: Partial<Params> = {}): Params {
  return {
    candidateBeruf: "Koch",
    candidateMaxLevel: 3,
    candidateMinLevel: 0,
    candidatePreferredLevel: 1,
    candidateRegions: ["Bayern"],
    candidateLanguages: ["de-B1"],
    candidateNeedsSponsorship: true,
    vacancyBeruf: "Koch",
    vacancyRegion: "Hamburg",
    vacancyTitle: "Koch",
    employerSponsorshipSignal: "YES" as SponsorshipSignal,
    occupationRelevant: true,
    ...overrides,
  };
}

describe("calculateFitScore — base case", () => {
  it("scores each component and totals them", () => {
    const f = calculateFitScore(base());
    expect(f).toMatchObject({ beruf: 32, region: 25, language: 14, sponsorship: 15, level: 1, total: 89 });
  });
});

describe("seniority gate", () => {
  it("zeroes everything when the vacancy is ABOVE the candidate's ceiling", () => {
    // "Bauleiter" → level 3; ceiling 1 → out of range.
    const f = calculateFitScore(base({ vacancyTitle: "Bauleiter", candidateMaxLevel: 1 }));
    expect(f).toMatchObject({ beruf: 0, region: 0, language: 0, sponsorship: 0, total: 0 });
    expect(f.level).toBe(3);
  });

  it("zeroes everything when the vacancy is BELOW the candidate's floor", () => {
    // "Koch" → level 1; floor 2 → out of range.
    const f = calculateFitScore(base({ vacancyTitle: "Koch", candidateMinLevel: 2 }));
    expect(f.total).toBe(0);
  });

  it("scores normally when the level is within range", () => {
    const f = calculateFitScore(base({ vacancyTitle: "Schichtleiter Koch", candidateMinLevel: 0, candidateMaxLevel: 3 }));
    expect(f.level).toBe(2);
    expect(f.total).toBeGreaterThan(0);
  });
});

describe("occupation relevance (beruf)", () => {
  it("awards 32 when relevant, 0 when not", () => {
    expect(calculateFitScore(base({ occupationRelevant: true })).beruf).toBe(32);
    expect(calculateFitScore(base({ occupationRelevant: false })).beruf).toBe(0);
  });
});

describe("region (nationwide placement)", () => {
  afterEach(() => { delete process.env.REGION_NATIONWIDE; });

  it("default: full points even when the vacancy city is NOT in the candidate's prefs", () => {
    expect(calculateFitScore(base({ candidateRegions: ["Bayern"], vacancyRegion: "Hamburg" })).region).toBe(25);
  });

  it("REGION_NATIONWIDE=false: 0 when the vacancy city is not in the candidate's prefs", () => {
    process.env.REGION_NATIONWIDE = "false";
    expect(calculateFitScore(base({ candidateRegions: ["Bayern"], vacancyRegion: "Hamburg" })).region).toBe(0);
  });

  it("REGION_NATIONWIDE=false: 25 when the city IS in the prefs", () => {
    process.env.REGION_NATIONWIDE = "false";
    expect(calculateFitScore(base({ candidateRegions: ["Hamburg"], vacancyRegion: "Hamburg" })).region).toBe(25);
  });

  it("REGION_NATIONWIDE=false: 25 when prefs include 'Deutschland' or are empty", () => {
    process.env.REGION_NATIONWIDE = "false";
    expect(calculateFitScore(base({ candidateRegions: ["Deutschland"], vacancyRegion: "Hamburg" })).region).toBe(25);
    expect(calculateFitScore(base({ candidateRegions: [], vacancyRegion: "Hamburg" })).region).toBe(25);
  });
});

describe("German-language tiers", () => {
  const lang = (langs: string[]) => calculateFitScore(base({ candidateLanguages: langs })).language;
  it("grades by CEFR level", () => {
    expect(lang(["de-C2"])).toBe(20);
    expect(lang(["de-C1"])).toBe(20);
    expect(lang(["de-B2"])).toBe(17);
    expect(lang(["de-B1"])).toBe(14);
    expect(lang(["de-A2"])).toBe(10);
    expect(lang(["de-A1"])).toBe(7);
  });
  it("gives a small score for unspecified German, 0 for no German", () => {
    expect(lang(["de"])).toBe(5);
    expect(lang(["en-C2", "az"])).toBe(0);
    expect(lang([])).toBe(0);
  });
});

describe("sponsorship", () => {
  const sig = (needs: boolean, s: string) =>
    calculateFitScore(base({ candidateNeedsSponsorship: needs, employerSponsorshipSignal: s as SponsorshipSignal })).sponsorship;

  it("candidate NEEDS sponsorship: YES=15, LIKELY=10, UNKNOWN/NO=0", () => {
    expect(sig(true, "YES")).toBe(15);
    expect(sig(true, "LIKELY")).toBe(10);
    expect(sig(true, "UNKNOWN")).toBe(0);
    expect(sig(true, "NO")).toBe(0);
  });

  it("candidate does NOT need sponsorship: openness bonus 10, but 0 for a 'NO' employer (dead-branch fix)", () => {
    expect(sig(false, "YES")).toBe(10);
    expect(sig(false, "LIKELY")).toBe(10);
    expect(sig(false, "UNKNOWN")).toBe(10);
    expect(sig(false, "NO")).toBe(0); // regression guard: used to wrongly be 10
  });
});

describe("level bonus (visa-hire realism)", () => {
  const bonusOf = (f: ReturnType<typeof calculateFitScore>, base: number) => f.total - base;
  it("rewards a vacancy one step below the preferred level most", () => {
    // preferred 2, vacLevel 1 (Koch) → diff 1 → +6.
    const f = calculateFitScore(base({ candidatePreferredLevel: 2, vacancyTitle: "Koch" }));
    // beruf32 + region25 + language14 + sponsorship15 = 86, +6 = 92
    expect(f.total).toBe(92);
    expect(bonusOf(f, 86)).toBe(6);
  });
  it("gives +3 at the exact preferred level, +1 two+ steps below, +0 above", () => {
    expect(calculateFitScore(base({ candidatePreferredLevel: 1, vacancyTitle: "Koch" })).total).toBe(89);          // diff 0 → +3
    expect(calculateFitScore(base({ candidatePreferredLevel: 3, vacancyTitle: "Koch" })).total).toBe(87);          // diff 2 → +1
    expect(calculateFitScore(base({ candidatePreferredLevel: 1, vacancyTitle: "Schichtleiter", candidateMaxLevel: 3 })).total)
      .toBe(86); // vacLevel 2 > preferred 1 → diff -1 → +0 (86 = 32+25+14+15)
  });
});

describe("total is capped at 100", () => {
  it("never exceeds 100 even with every component maxed", () => {
    const f = calculateFitScore(base({
      candidateLanguages: ["de-C2"],      // 20
      candidatePreferredLevel: 2,          // diff 1 → +6
      employerSponsorshipSignal: "YES",    // 15
    }));
    // 32 + 25 + 20 + 15 + 6 = 98 → under 100 here; assert the ceiling holds generally
    expect(f.total).toBeLessThanOrEqual(100);
    expect(f.total).toBe(98);
  });
});
