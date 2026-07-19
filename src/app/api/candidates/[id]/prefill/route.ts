import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/candidates/[id]/prefill — candidate data mapped to common German
 * application-form fields, for the "MZ Autofill" browser extension (Feature 2).
 *
 * The extension calls this with credentials:"include" — the admin's existing MZ
 * session cookie authenticates it (enforced by middleware); no separate token.
 * It fills form fields client-side after the human clears any captcha; this
 * endpoint never touches the external site.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const c = await prisma.candidate.findUnique({
      where: { id: params.id },
      select: {
        name: true, email: true, phone: true, gender: true, dateOfBirth: true,
        nationality: true, address: true, currentCity: true, currentCountry: true,
        beruf: true, desiredPosition: true, germanLevel: true, englishLevel: true,
        salaryExpectation: true, visaStatus: true, drivingLicense: true,
        needsSponsorship: true, regionPrefs: true, availableFrom: true,
        cvData: true, cvFileName: true, cvMimeType: true,
      },
    });
    if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const parts = c.name.trim().split(/\s+/);
    const vorname = parts[0] ?? "";
    const nachname = parts.length > 1 ? parts.slice(1).join(" ") : "";
    const anrede = c.gender === "male" ? "Herr" : c.gender === "female" ? "Frau" : "";
    // Always the MZ agency address (not the candidate's), so an employer who
    // replies from the application form reaches MZ — the same inbox the reply
    // detection monitors. This keeps MZ in the loop as the broker.
    const contactEmail = process.env.AGENCY_CONTACT_EMAIL || process.env.SMTP_USER || "info@mz-personalvermittlung.de";

    // German application forms overwhelmingly use these field labels/names; the
    // extension's selector map (config/selectors.json) resolves each to inputs.
    const fields: Record<string, string> = {
      anrede,
      vorname,
      nachname,
      name: c.name,
      email: contactEmail,
      telefon: c.phone ?? "",
      geburtsdatum: c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : "",
      // Earliest possible start date (ISO — native date inputs accept it).
      starttermin: c.availableFrom ? c.availableFrom.toISOString().slice(0, 10) : "",
      nationalitaet: c.nationality ?? "",
      adresse: c.address ?? "",
      // Desired place of employment — processed BEFORE `ort` so it claims a
      // "Gewünschter Anstellungsort" field instead of the current-city value.
      anstellungsort: (c.regionPrefs ?? []).filter((r) => r && r !== "Deutschland")[0] || c.currentCity || "",
      ort: c.currentCity ?? "",
      land: c.currentCountry ?? "Deutschland",
      beruf: c.desiredPosition?.trim() || c.beruf || "",
      deutschniveau: c.germanLevel ?? "",
      englischniveau: c.englishLevel ?? "",
      // Additional recruiter-entered facts (only sent when actually stored — the
      // extension skips empty values, so nothing is fabricated on a real
      // application). Salary + legal-status are the fields ATS forms ask for most.
      gehaltswunsch: c.salaryExpectation ?? "",
      aufenthaltstitel: c.visaStatus ?? "",   // residence permit ← visa status
      arbeitserlaubnis: c.visaStatus ?? "",   // work permit (free-text) ← visa status
      fuehrerschein: c.drivingLicense ?? "",
      // Weekly working time — the agency places FULL-TIME candidates only, so on
      // a "hours per week?" radio group the Vollzeit option is always correct.
      arbeitszeitVollzeit: "Vollzeit",
      // "Valid work permit?" as a CHECKBOX: tick ONLY when the candidate does not
      // need visa sponsorship (EU / already authorised). When sponsorship IS
      // needed the value is empty, so the box is left unchecked for the human —
      // never a false "yes" on a legal declaration.
      arbeitserlaubnisJa: c.needsSponsorship === false ? "Ja" : "",
    };

    // CV as base64 so the extension can attach it to file inputs (Lebenslauf).
    const cv = c.cvData
      ? {
          filename: c.cvFileName || `${c.name.replace(/\s+/g, "_")}_CV.pdf`,
          mimeType: c.cvMimeType || "application/pdf",
          dataBase64: Buffer.from(c.cvData).toString("base64"),
        }
      : null;

    return NextResponse.json({ candidateId: params.id, fields, cv });
  } catch (err) {
    return apiError(err);
  }
}
