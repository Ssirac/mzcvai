/**
 * Single source of truth for mapping a candidate to German application-form
 * fields. Used by BOTH the /api/candidates/[id]/prefill endpoint (feeding the
 * human MZ Autofill extension) and the server-side auto-apply engine — so an
 * auto-submitted form carries the exact same values a human would have filled.
 *
 * Pure + dependency-light (only reads AGENCY env). No DB, no side effects.
 */
import { AGENCY_NAME } from "@/lib/brand";

// The subset of candidate columns needed to build the fields. Matches the select
// in the prefill route.
export interface ApplicationCandidate {
  name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  nationality: string | null;
  address: string | null;
  currentCity: string | null;
  currentCountry: string | null;
  beruf: string;
  desiredPosition: string | null;
  germanLevel: string | null;
  englishLevel: string | null;
  yearsExperience: number | null;
  salaryExpectation: string | null;
  visaStatus: string | null;
  drivingLicense: string | null;
  needsSponsorship: boolean | null;
  regionPrefs: string[];
  availableFrom: Date | null;
  cvData: Buffer | Uint8Array | null;
  cvFileName: string | null;
  cvMimeType: string | null;
}

export interface ApplicationCv {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface ApplicationPayload {
  fields: Record<string, string>;
  cv: ApplicationCv | null;
}

export function buildApplicationFields(c: ApplicationCandidate): ApplicationPayload {
  const parts = c.name.trim().split(/\s+/);
  const vorname = parts[0] ?? "";
  const nachname = parts.length > 1 ? parts.slice(1).join(" ") : "";
  const anrede = c.gender === "male" ? "Herr" : c.gender === "female" ? "Frau" : "";
  const geschlecht = c.gender === "male" ? "männlich" : c.gender === "female" ? "weiblich" : c.gender === "other" ? "divers" : "";

  // Always the MZ agency address (not the candidate's), so an employer who
  // replies from the application form reaches MZ — the same inbox reply detection
  // monitors. Keeps MZ in the loop as the broker.
  const contactEmail = process.env.AGENCY_CONTACT_EMAIL || process.env.SMTP_USER || "info@mz-personalvermittlung.de";

  const rawNat = (c.nationality ?? "").trim();
  const nationalitaet = !rawNat
    ? "Aserbaidschan"
    : /aserbaid|azerbaij|az[əe]rbayc?an/i.test(rawNat) ? "Aserbaidschan" : rawNat;

  // Honest work-permit answer — never a false "Ja".
  const permitAnswer = c.needsSponsorship === false
    ? "Ja"
    : `Nein, wird über die Personalvermittlung ${AGENCY_NAME} organisiert`;

  const fields: Record<string, string> = {
    anrede,
    geschlecht,
    vorname,
    nachname,
    name: c.name,
    email: contactEmail,
    telefon: c.phone ?? "",
    geburtsdatum: c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : "",
    starttermin: c.availableFrom ? c.availableFrom.toISOString().slice(0, 10) : "",
    nationalitaet,
    adresse: c.address ?? "",
    anstellungsort: (c.regionPrefs ?? []).filter((r) => r && r !== "Deutschland")[0] || c.currentCity || "",
    ort: c.currentCity ?? "",
    land: c.currentCountry ?? "Deutschland",
    beruf: c.desiredPosition?.trim() || c.beruf || "",
    berufserfahrung: c.yearsExperience ? String(c.yearsExperience) : "",
    deutschniveau: c.germanLevel ?? "",
    englischniveau: c.englishLevel || "A1",
    gehaltswunsch: c.salaryExpectation?.trim() || "nach Vereinbarung",
    aufenthaltstitel: c.visaStatus?.trim() || permitAnswer,
    arbeitserlaubnis: c.visaStatus?.trim() || permitAnswer,
    fuehrerschein: c.drivingLicense ?? "",
    arbeitszeitVollzeit: "Vollzeit",
    arbeitserlaubnisJa: c.needsSponsorship === false ? "Ja" : "",
  };

  const cv: ApplicationCv | null = c.cvData
    ? {
        filename: c.cvFileName || `${c.name.replace(/\s+/g, "_")}_CV.pdf`,
        mimeType: c.cvMimeType || "application/pdf",
        dataBase64: Buffer.from(c.cvData).toString("base64"),
      }
    : null;

  return { fields, cv };
}

// The candidate columns to `select` when loading a record for buildApplicationFields.
export const APPLICATION_CANDIDATE_SELECT = {
  name: true, email: true, phone: true, gender: true, dateOfBirth: true,
  nationality: true, address: true, currentCity: true, currentCountry: true,
  beruf: true, desiredPosition: true, germanLevel: true, englishLevel: true,
  yearsExperience: true, salaryExpectation: true, visaStatus: true, drivingLicense: true,
  needsSponsorship: true, regionPrefs: true, availableFrom: true,
  cvData: true, cvFileName: true, cvMimeType: true,
} as const;
