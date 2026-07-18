import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/rbac";
import { autoIngestForBeruf } from "@/services/autoIngest";
import { matchCandidateToVacancies } from "@/services/scoring";
import { candidateProfiles } from "@/lib/candidateProfiles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/candidates/[id]/fetch-jobs — the "Elanları çək" button: pull fresh
// listings for THIS candidate's occupation from every available source right
// now, then re-match, so new jobs appear immediately instead of waiting for
// the 4-hourly refresh. Synchronous — the UI shows progress and the result.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;

    const candidate = await prisma.candidate.findUnique({
      where: { id: params.id },
      select: { beruf: true, desiredPosition: true, experience: true, status: true },
    });
    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Full-CV fetch: pull listings for the desired position AND the CV's other
    // occupations (beruf, experience titles) — capped at 3 profiles so the
    // request stays well inside maxDuration.
    const profiles = candidateProfiles(candidate).slice(0, 3);
    if (profiles.length === 0) {
      return NextResponse.json({ error: "Candidate has no occupation set" }, { status: 400 });
    }

    let vacanciesNew = 0;
    const sources = new Set<string>();
    for (const profile of profiles) {
      const r = await autoIngestForBeruf(profile, "Deutschland");
      vacanciesNew += r.vacanciesNew;
      for (const s of r.sources) sources.add(s);
    }
    const match = await matchCandidateToVacancies(params.id);

    return NextResponse.json({
      ok: true,
      vacanciesNew,
      sources: Array.from(sources),
      matched: match.matched,
      removed: match.removed,
    });
  } catch (err) {
    return apiError(err);
  }
}
