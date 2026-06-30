import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/inbox/unread — count of replies the user hasn't seen yet (nav badge).
// Also returns per-candidate counts so the candidate list can flag who has new mail.
export async function GET() {
  try {
    const unread = await prisma.outreach.findMany({
      where: { repliedAt: { not: null }, replyRead: false },
      select: { match: { select: { candidateId: true } } },
    });

    const byCandidate: Record<string, number> = {};
    for (const u of unread) {
      const id = u.match?.candidateId;
      if (id) byCandidate[id] = (byCandidate[id] ?? 0) + 1;
    }

    return NextResponse.json({ count: unread.length, byCandidate });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, count: 0, byCandidate: {} }, { status: 500 });
  }
}
