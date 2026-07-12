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
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const c = await prisma.candidate.findUnique({
      where: { id: params.id },
      select: {
        name: true, email: true, phone: true, gender: true, dateOfBirth: true,
        nationality: true, address: true, currentCity: true, currentCountry: true,
        beruf: true, desiredPosition: true, germanLevel: true,
        cvData: true, cvFileName: true, cvMimeType: true,
      },
    });
    if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const parts = c.name.trim().split(/\s+/);
    const vorname = parts[0] ?? "";
    const nachname = parts.length > 1 ? parts.slice(1).join(" ") : "";
    const anrede = c.gender === "male" ? "Herr" : c.gender === "female" ? "Frau" : "";

    // German application forms overwhelmingly use these field labels/names; the
    // extension's selector map (config/selectors.json) resolves each to inputs.
    const fields: Record<string, string> = {
      anrede,
      vorname,
      nachname,
      name: c.name,
      email: c.email ?? "",
      telefon: c.phone ?? "",
      geburtsdatum: c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : "",
      nationalitaet: c.nationality ?? "",
      adresse: c.address ?? "",
      ort: c.currentCity ?? "",
      land: c.currentCountry ?? "Deutschland",
      beruf: c.desiredPosition?.trim() || c.beruf || "",
      deutschniveau: c.germanLevel ?? "",
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
