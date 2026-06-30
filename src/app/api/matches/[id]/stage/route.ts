import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

const STAGES = ["SUGGESTED", "APPROVED", "SENT", "REPLIED", "INTERVIEW", "PLACED", "REJECTED"] as const;
type Stage = (typeof STAGES)[number];

// PATCH /api/matches/[id]/stage  { status }
// Moves one application through the placement pipeline. When an application is
// marked PLACED, the candidate is set to PLACED too (they're hired); this is the
// signal that nothing fell through.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const status = body.status as Stage;
    if (!STAGES.includes(status)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    const match = await prisma.match.update({
      where: { id: params.id },
      data: { status },
      select: { id: true, candidateId: true },
    });

    if (status === "PLACED") {
      await prisma.candidate.update({
        where: { id: match.candidateId },
        data: { status: "PLACED" },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return apiError(err);
  }
}
