import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/rbac";
import { matchCandidateToVacancies } from "@/services/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/admin/all-germany — set EVERY candidate's region preference to
// all-Germany ("Deutschland"), so matching is no longer limited to a single
// Bundesland, then re-match so the wider job pool lands immediately. Idempotent
// (safe to re-run). Returns how many candidates were widened and re-matched.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;

    // Widen everyone to all-Germany. regionPrefs = ["Deutschland"] is the
    // sentinel the matcher reads as "no region restriction".
    const updated = await prisma.candidate.updateMany({
      data: { regionPrefs: ["Deutschland"] },
    });

    // Re-match active/pending candidates so the broader pool shows now (not in
    // 4 hours). Bounded loop over ~a dozen candidates, well under maxDuration.
    const candidates = await prisma.candidate.findMany({
      where: { status: { in: ["ACTIVE", "PENDING"] } },
      select: { id: true },
    });
    let matched = 0;
    for (const c of candidates) {
      try {
        const m = await matchCandidateToVacancies(c.id);
        matched += m.matched;
      } catch { /* one failure must not stop the rest */ }
    }

    return NextResponse.json({ ok: true, candidatesWidened: updated.count, rematched: candidates.length, newMatches: matched });
  } catch (err) {
    return apiError(err);
  }
}
