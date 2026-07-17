import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import { matchCandidateToVacancies } from "@/services/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/matches/rematch-all — recompute matches for every ACTIVE candidate.
// Re-matching applies the occupation-family gate, so cross-profession matches
// that no longer qualify are removed (except any already tied to a sent
// outreach, which are kept for history). This never sends email.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    const actor = await getSessionUser(req);
    // Optional single-candidate mode: body { candidateId } re-matches just one —
    // fast enough for a synchronous call (the all-candidates loop can outlive
    // proxy timeouts, and Next kills handlers when the client disconnects).
    let onlyId: string | null = null;
    try { onlyId = (await req.json())?.candidateId ?? null; } catch { /* full run */ }
    const candidates = await prisma.candidate.findMany({
      where: onlyId ? { id: onlyId } : { status: "ACTIVE" },
      select: { id: true, name: true },
    });

    let matched = 0;
    let removed = 0;
    const perCandidate: { name: string; matched: number; removed: number }[] = [];
    for (const c of candidates) {
      try {
        const r = await matchCandidateToVacancies(c.id);
        matched += r.matched;
        removed += r.removed;
        perCandidate.push({ name: c.name, matched: r.matched, removed: r.removed });
      } catch (e) {
        perCandidate.push({ name: c.name, matched: 0, removed: 0 });
        console.error(`[rematch-all] ${c.name}:`, (e as Error).message);
      }
    }

    await logAudit({ actor, action: "OUTREACH_SEND", targetType: "rematch", targetId: `candidates:${candidates.length}`, meta: { matched, removed } });

    return NextResponse.json({ ok: true, candidates: candidates.length, matched, removed, perCandidate });
  } catch (err) {
    return apiError(err);
  }
}
