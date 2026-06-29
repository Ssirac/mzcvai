import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

// POST /api/candidates/[id]/reset-outreach
// Deletes ALL outreach (incl. SENT) for this candidate's matches, so every job
// returns to "Uyğun işlər" and can be sent again. Also clears the per-employer
// cooldown (which is derived from SENT outreach records) for these employers.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Collect this candidate's employer ids first (to clear their OUTREACH_SENT
    // behavior logs too, for a clean re-send).
    const matches = await prisma.match.findMany({
      where: { candidateId: params.id },
      select: { id: true, employerId: true },
    });
    const matchIds = matches.map((m) => m.id);
    const employerIds = Array.from(new Set(matches.map((m) => m.employerId)));

    const { count } = await prisma.outreach.deleteMany({
      where: { matchId: { in: matchIds } },
    });

    // Remove the OUTREACH_SENT signal logs for these employers so a fresh send
    // isn't treated as a duplicate in behavior scoring.
    await prisma.employerSignalLog.deleteMany({
      where: { employerId: { in: employerIds }, eventType: "OUTREACH_SENT" },
    });

    return NextResponse.json({ ok: true, deleted: count });
  } catch (err) {
    return apiError(err);
  }
}
