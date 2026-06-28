import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/candidates/[id]/outreach — full communication history for a candidate:
// which employers/vacancies were contacted, what was sent, and the status.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const outreach = await prisma.outreach.findMany({
      where: { match: { candidateId: params.id } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        subject: true,
        draftBody: true,
        toAddress: true,
        channel: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        sentAt: true,
        openedAt: true,
        repliedAt: true,
        bouncedAt: true,
        match: {
          select: {
            employer: { select: { name: true, city: true, region: true, sponsorshipSignal: true } },
            vacancy: { select: { title: true, url: true, source: true } },
          },
        },
      },
    });

    const counts = outreach.reduce(
      (acc, o) => {
        acc.total++;
        if (o.status === "SENT" || o.sentAt) acc.sent++;
        if (o.status === "DRAFT") acc.draft++;
        if (o.status === "REPLIED") acc.replied++;
        return acc;
      },
      { total: 0, sent: 0, draft: 0, replied: 0 }
    );

    return NextResponse.json({ outreach, counts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
