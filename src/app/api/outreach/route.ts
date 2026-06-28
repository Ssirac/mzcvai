import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { createOutreachDraft } from "@/services/outreach";

// GET /api/outreach?status=DRAFT|APPROVED|SENT
export async function GET(req: NextRequest) {
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  try {
    const outreaches = await prisma.outreach.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        match: {
          include: {
            candidate: { select: { name: true, beruf: true } },
            employer: { select: { name: true, city: true, genericEmail: true, sponsorshipSignal: true } },
            vacancy: { select: { title: true, region: true } },
          },
        },
      },
    });
    return NextResponse.json({ outreaches });
  } catch (err) {
    return apiError(err);
  }
}

// POST /api/outreach — create a draft for a match
export async function POST(req: NextRequest) {
  try {
    const { matchId } = await req.json();
    if (!matchId) return NextResponse.json({ error: "matchId required" }, { status: 400 });

    const outreachId = await createOutreachDraft(matchId);
    return NextResponse.json({ ok: true, outreachId });
  } catch (err) {
    return apiError(err);
  }
}
