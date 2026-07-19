import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { freshVacancyWhere, undispatchedWhere, notRejectedWhere } from "@/lib/matchFilters";
import { matchCandidateToVacancies } from "@/services/scoring";
import { autoIngestForBeruf } from "@/services/autoIngest";
import { sendAllForCandidate } from "@/services/outreach";

// GET /api/candidates
export async function GET() {
  try {
    const candidates = await prisma.candidate.findMany({
      orderBy: { createdAt: "desc" },
      omit: { cvData: true }, // never ship the raw file in the list
      include: {
        // Count only FRESH matches (same filter as the matches view) — a raw
        // count also included expired/stale listings, so the sidebar said e.g.
        // "573 uyğun iş" while the detail view correctly showed 188.
        // AND only matches with no dispatched mail (auto or manual): once an
        // application went out, the job leaves "Uyğun işlər", so the badge
        // must drop with it instead of keeping the old inflated number.
        // Also exclude recruiter-rejected (BAD) matches, so the badge matches
        // the detail list which hides them too.
        _count: {
          select: {
            matches: { where: { vacancy: freshVacancyWhere(), ...undispatchedWhere(), ...notRejectedWhere() } },
          },
        },
      },
    });
    // Expose a lightweight flag instead of the bytes
    const withFlag = candidates.map((c) => ({ ...c, hasCv: !!c.cvFileName }));
    return NextResponse.json({ candidates: withFlag });
  } catch (err) {
    return apiError(err);
  }
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// POST /api/candidates — create/update + auto-match
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const name = (b.name ?? "").trim();
    const beruf = (b.beruf ?? "").trim();

    if (!name || !beruf) {
      return NextResponse.json({ error: "name and beruf are required" }, { status: 400 });
    }

    const data = {
      name,
      phone: b.phone || null,
      beruf,
      regionPrefs: asStringArray(b.regionPrefs),
      languages: asStringArray(b.languages),
      needsSponsorship: b.needsSponsorship ?? true,
      visaStatus: b.visaStatus || null,
      notes: b.notes || null,
      // Detailed CV
      dateOfBirth: parseDate(b.dateOfBirth),
      gender: b.gender || null,
      nationality: b.nationality || null,
      maritalStatus: b.maritalStatus || null,
      currentCity: b.currentCity || null,
      currentCountry: b.currentCountry || null,
      address: b.address || null,
      photoUrl: b.photoUrl || null,
      desiredPosition: b.desiredPosition || null,
      yearsExperience: typeof b.yearsExperience === "number" ? b.yearsExperience : (b.yearsExperience ? parseInt(b.yearsExperience) || null : null),
      salaryExpectation: b.salaryExpectation || null,
      availableFrom: parseDate(b.availableFrom),
      willingToRelocate: b.willingToRelocate ?? true,
      drivingLicense: b.drivingLicense || null,
      germanLevel: b.germanLevel || null,
      englishLevel: b.englishLevel || null,
      education: Array.isArray(b.education) ? b.education : undefined,
      experience: Array.isArray(b.experience) ? b.experience : undefined,
      skills: asStringArray(b.skills),
      certificates: asStringArray(b.certificates),
    };

    const statusData = ["ACTIVE", "PENDING", "PLACED", "ARCHIVED"].includes(b.status)
      ? { status: b.status as "ACTIVE" | "PENDING" | "PLACED" | "ARCHIVED" }
      : {};

    // Original uploaded CV file (base64 from the client). Only PDFs, max ~20 MB.
    let cvFields: { cvData?: Uint8Array<ArrayBuffer>; cvFileName?: string; cvMimeType?: string } = {};
    if (typeof b.cvFileBase64 === "string" && b.cvFileBase64.length > 0) {
      const buf = Buffer.from(b.cvFileBase64, "base64");
      if (buf.length > 0 && buf.length <= 20 * 1024 * 1024) {
        const bytes = new Uint8Array(buf.length);
        bytes.set(buf);
        cvFields = {
          cvData: bytes,
          cvFileName: typeof b.cvFileName === "string" ? b.cvFileName.slice(0, 200) : "cv.pdf",
          cvMimeType: typeof b.cvMimeType === "string" ? b.cvMimeType : "application/pdf",
        };
      }
    }

    // Identify create vs update by EXPLICIT id only — never by email. Using email
    // as the key caused new candidates (whose form still carried a previous
    // person's email) to silently overwrite an existing candidate.
    const editId = typeof b.id === "string" && b.id.trim() ? b.id.trim() : null;
    const email = typeof b.email === "string" && b.email.trim() ? b.email.trim() : null;
    const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

    let candidate;
    if (editId) {
      // Edit an existing candidate by id. Try with the email; if it collides with
      // another candidate, keep this one's email unchanged instead of failing.
      try {
        candidate = await prisma.candidate.update({
          where: { id: editId },
          data: { email, ...data, ...statusData, ...cvFields },
          omit: { cvData: true },
        });
      } catch (e) {
        if (!isUnique(e)) throw e;
        candidate = await prisma.candidate.update({
          where: { id: editId },
          data: { ...data, ...statusData, ...cvFields },
          omit: { cvData: true },
        });
      }
    } else {
      // New candidate — always create. If the email already belongs to someone
      // else, save this candidate WITHOUT it rather than overwriting/losing data.
      try {
        candidate = await prisma.candidate.create({
          data: { email, ...data, ...statusData, ...cvFields },
          omit: { cvData: true },
        });
      } catch (e) {
        if (!isUnique(e)) throw e;
        candidate = await prisma.candidate.create({
          data: { email: null, ...data, ...statusData, ...cvFields },
          omit: { cvData: true },
        });
      }
    }

    // Auto-run matching immediately after creation
    let matchResult = await matchCandidateToVacancies(candidate.id);
    let autoIngest: { vacanciesNew: number; sources: string[] } | null = null;

    // If no jobs exist for this profession yet, fetch them automatically from
    // the fast legal sources, then re-match — so every candidate gets results
    // without a manual ingest step.
    if (matchResult.matched < 5) {
      const region = candidate.regionPrefs.length && !candidate.regionPrefs.includes("Deutschland")
        ? candidate.regionPrefs[0]
        : "Deutschland";
      const profile = [candidate.beruf, candidate.desiredPosition].filter(Boolean).join(" / ");
      autoIngest = await autoIngestForBeruf(profile, region);
      if (autoIngest.vacanciesNew > 0) {
        matchResult = await matchCandidateToVacancies(candidate.id);
      }
    }

    // Auto-pilot: once the candidate is saved WITH a CV on file, applications to
    // their matched jobs go out automatically in the background (all daily caps,
    // cooldowns and opt-outs enforced in the send path). Fire-and-forget so the
    // save request returns immediately; Railway runs a persistent server, so the
    // background work completes after the response.
    if (process.env.AUTO_SEND_ENABLED !== "false" && candidate.status === "ACTIVE") {
      const hasCv = await prisma.candidate.findUnique({
        where: { id: candidate.id },
        select: { cvData: true },
      });
      if (hasCv?.cvData) {
        void sendAllForCandidate(candidate.id, "auto-pilot").catch((e) =>
          console.error("[auto-pilot] send after save failed:", (e as Error).message)
        );
      }
    }

    return NextResponse.json({
      ok: true,
      candidate,
      matchesFound: matchResult.matched,
      autoIngest,
    });
  } catch (err) {
    return apiError(err);
  }
}
