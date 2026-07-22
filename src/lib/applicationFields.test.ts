import { describe, it, expect } from "vitest";
import { buildApplicationFields, type ApplicationCandidate } from "./applicationFields";

const base: ApplicationCandidate = {
  name: "Elvin Mammadov", email: "elvin@example.com", phone: "+49 111",
  gender: "male", dateOfBirth: new Date("1995-03-02"), nationality: null,
  address: "Musterstr. 1", currentCity: "Berlin", currentCountry: "Deutschland",
  beruf: "Koch", desiredPosition: "Chef de Partie", germanLevel: "B1", englishLevel: null,
  yearsExperience: 5, salaryExpectation: null, visaStatus: null, drivingLicense: null,
  needsSponsorship: true, regionPrefs: ["Deutschland", "Bayern"], availableFrom: null,
  cvData: Buffer.from("PDF"), cvFileName: "cv.pdf", cvMimeType: "application/pdf",
};

describe("buildApplicationFields", () => {
  it("splits the name and picks the desired position", () => {
    const { fields } = buildApplicationFields(base);
    expect(fields.vorname).toBe("Elvin");
    expect(fields.nachname).toBe("Mammadov");
    expect(fields.beruf).toBe("Chef de Partie");
    expect(fields.arbeitszeitVollzeit).toBe("Vollzeit");
  });

  it("defaults an empty nationality to Aserbaidschan and normalises spellings", () => {
    expect(buildApplicationFields(base).fields.nationalitaet).toBe("Aserbaidschan");
    expect(buildApplicationFields({ ...base, nationality: "Azerbaijani" }).fields.nationalitaet).toBe("Aserbaidschan");
    expect(buildApplicationFields({ ...base, nationality: "German" }).fields.nationalitaet).toBe("German");
  });

  it("never claims a false work permit when sponsorship is needed", () => {
    const needs = buildApplicationFields(base).fields;
    expect(needs.arbeitserlaubnisJa).toBe(""); // checkbox left empty
    expect(needs.arbeitserlaubnis.toLowerCase()).toContain("nein");
    const authorised = buildApplicationFields({ ...base, needsSponsorship: false }).fields;
    expect(authorised.arbeitserlaubnisJa).toBe("Ja");
    expect(authorised.arbeitserlaubnis).toBe("Ja");
  });

  it("signals nationwide availability for anstellungsort (not one region)", () => {
    // The candidate can work anywhere in Germany, so we never pin a single region.
    expect(buildApplicationFields(base).fields.anstellungsort).toBe("deutschlandweit");
  });

  it("uses the agency contact email, not the candidate's own", () => {
    // The employer must reply to MZ, so the form email is always the agency's.
    expect(buildApplicationFields(base).fields.email).not.toBe("elvin@example.com");
    expect(buildApplicationFields(base).fields.email).toContain("@");
  });

  it("attaches the CV as base64 when present, null otherwise", () => {
    expect(buildApplicationFields(base).cv?.dataBase64).toBe(Buffer.from("PDF").toString("base64"));
    expect(buildApplicationFields({ ...base, cvData: null }).cv).toBeNull();
  });
});
