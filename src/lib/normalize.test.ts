import { describe, it, expect } from "vitest";
import { normalizeEmployerName, normalizeDomain, domainOfEmail } from "./normalize";

describe("normalizeEmployerName", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeEmployerName("Hotel Adler GmbH & Co. KG")).toBe("hotel adler");
    expect(normalizeEmployerName("Müller AG")).toBe("müller");
    expect(normalizeEmployerName("deli carte GmbH & Co. KG")).toBe("deli carte");
  });
  it("collapses whitespace/case", () => {
    expect(normalizeEmployerName("  ACME   Foods  ")).toBe("acme foods");
  });
});

describe("normalizeDomain", () => {
  it("extracts host from URL and bare domain", () => {
    expect(normalizeDomain("https://www.firma.de/karriere")).toBe("firma.de");
    expect(normalizeDomain("firma.de")).toBe("firma.de");
    expect(normalizeDomain("http://sub.firma.de")).toBe("sub.firma.de");
  });
  it("rejects free webmail hosts and junk", () => {
    expect(normalizeDomain("https://gmail.com")).toBe(null);
    expect(normalizeDomain("not-a-domain")).toBe(null);
    expect(normalizeDomain(null)).toBe(null);
  });
});

describe("domainOfEmail", () => {
  it("returns company domain, null for free hosts", () => {
    expect(domainOfEmail("bewerbung@firma.de")).toBe("firma.de");
    expect(domainOfEmail("hans@gmail.com")).toBe(null);
    expect(domainOfEmail(null)).toBe(null);
  });
});
