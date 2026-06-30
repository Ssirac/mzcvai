import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/candidates/[id]/matches — get scored matches for a candidate
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Hide stale listings (30+ days old) even before the background sweep
    // deletes them, so the candidate only ever sees currently-open jobs.
    const EXPIRY_DAYS = 30;
    const expiryCutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const matches = await prisma.match.findMany({
      where: {
        candidateId: params.id,
        vacancy: { status: "ACTIVE", foundAt: { gte: expiryCutoff } },
      },
      orderBy: [
        { employer: { score: "desc" } },
        { fitScore: "desc" },
      ],
      include: {
        vacancy: {
          select: { title: true, beruf: true, region: true, applyChannel: true, applyValue: true, postedAt: true, url: true, source: true },
        },
        employer: {
          select: {
            name: true, city: true, region: true, stars: true, rooms: true,
            score: true, scoreBreakdown: true, sponsorshipSignal: true,
            genericEmail: true, emailSource: true, emailStatus: true,
            applyFormUrl: true, phone: true,
            website: true,
          },
        },
        outreach: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json({ matches });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
