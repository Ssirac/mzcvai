import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/inbox — all employer replies across candidates, newest first.
// Powers the "Gələn maillər" view so the user reads responses inside the app.
export async function GET() {
  try {
    const replies = await prisma.outreach.findMany({
      where: { repliedAt: { not: null } },
      orderBy: { repliedAt: "desc" },
      take: 200,
      select: {
        id: true,
        repliedAt: true,
        replyFrom: true,
        replySubject: true,
        replyText: true,
        toAddress: true,
        match: {
          select: {
            candidate: { select: { id: true, name: true } },
            employer: { select: { name: true } },
            vacancy: { select: { title: true, url: true } },
          },
        },
      },
    });

    return NextResponse.json({ replies, count: replies.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
