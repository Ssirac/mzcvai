import { describe, it, expect } from "vitest";
import {
  berufSearchKeywords, berufMatches, isPartTimeJob, isNonGermanLocation, seniorityLevel,
  classifyEmploymentType,
} from "./berufMap";

describe("berufSearchKeywords — AZ→DE + synonyms", () => {
  it("translates an Azerbaijani beruf to the German family", () => {
    const kw = berufSearchKeywords("Aşpaz");
    expect(kw).toContain("koch");
    expect(kw).toContain("küchenhilfe");
  });

  it("maps santexnik → installateur family", () => {
    expect(berufSearchKeywords("Santexnik")).toContain("installateur");
  });

  it("does NOT leak Azerbaijani terms for a German beruf (clean search slugs)", () => {
    const kw = berufSearchKeywords("Koch").map((k) => k.toLowerCase());
    expect(kw).toContain("koch");
    expect(kw).not.toContain("aşpaz");
    expect(kw).not.toContain("santexnik");
  });
});

describe("berufMatches", () => {
  it("matches an AZ candidate beruf to a German vacancy", () => {
    expect(berufMatches("Aşpaz", "Koch", "Koch (m/w/d)")).toBe(true);
    expect(berufMatches("Ofisiant", "Service", "Restaurantfachmann (m/w/d)")).toBe(true);
    expect(berufMatches("Santexnik", "Installateur", "Anlagenmechaniker SHK")).toBe(true);
  });

  it("does not produce a false positive across unrelated occupations", () => {
    expect(berufMatches("Aşpaz", "Elektriker", "Elektriker (m/w/d)")).toBe(false);
  });
});

describe("isPartTimeJob", () => {
  it("flags part-time by title", () => {
    expect(isPartTimeJob("Koch (m/w/d) - Teilzeit")).toBe(true);
    expect(isPartTimeJob("Aushilfe Minijob")).toBe(true);
  });
  it("keeps full-time", () => {
    expect(isPartTimeJob("Koch (m/w/d) Vollzeit")).toBe(false);
  });
  it("part-time type only when no full-time signal", () => {
    expect(isPartTimeJob("Koch", ["Teilzeit"])).toBe(true);
    expect(isPartTimeJob("Koch", ["Vollzeit oder Teilzeit"])).toBe(false);
  });
  it("hard mini-job signal in description", () => {
    expect(isPartTimeJob("Koch", [], "520-Euro-Basis, geringfügig")).toBe(true);
  });
  it("KEEPS 'Vollzeit oder Teilzeit' — offers full-time", () => {
    expect(isPartTimeJob("Koch Vollzeit oder Teilzeit")).toBe(false);
    expect(isPartTimeJob("Servicekraft (Voll- und Teilzeit)")).toBe(false);
    expect(isPartTimeJob("Koch Vollzeit", [], "Teilzeit möglich")).toBe(false);
  });
});

describe("classifyEmploymentType", () => {
  it("distinguishes the five types", () => {
    expect(classifyEmploymentType("Koch in Vollzeit")).toBe("FULL_TIME");
    expect(classifyEmploymentType("Reinigungskraft Teilzeit")).toBe("PART_TIME");
    expect(classifyEmploymentType("Aushilfe (Minijob)")).toBe("MINIJOB");
    expect(classifyEmploymentType("Koch Vollzeit oder Teilzeit")).toBe("FULL_OR_PART");
    expect(classifyEmploymentType("Koch (m/w/d)")).toBe("UNKNOWN");
  });
  it("nur Teilzeit is part-time only even if described at length", () => {
    expect(classifyEmploymentType("Koch", [], "Diese Stelle ist nur in Teilzeit zu besetzen")).toBe("PART_TIME");
  });
  it("incidental 'Teilzeit' in description alone stays UNKNOWN (kept)", () => {
    expect(classifyEmploymentType("Barkeeper", [], "Einige Kollegen arbeiten in Teilzeit")).toBe("UNKNOWN");
  });
});

describe("isNonGermanLocation", () => {
  it("flags foreign locations", () => {
    expect(isNonGermanLocation("Wien")).toBe(true);
    expect(isNonGermanLocation("Zürich, Schweiz")).toBe(true);
  });
  it("keeps German locations and avoids substring false positives", () => {
    expect(isNonGermanLocation("Berlin")).toBe(false);
    expect(isNonGermanLocation("Bernau")).toBe(false); // contains "bern" but is German
  });
});

describe("seniorityLevel", () => {
  it("ranks by seniority", () => {
    expect(seniorityLevel("Küchenchef")).toBe(3);
    expect(seniorityLevel("Sous Chef")).toBe(2);
    expect(seniorityLevel("Koch")).toBe(1);
    expect(seniorityLevel("Küchenhilfe")).toBe(0);
  });
});
