import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

// POST /api/inbox/read  { candidateId? }
// Marks replies as seen so the notification badge clears. With candidateId,
// marks only that candidate's replies (when opening their view); otherwise all.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const candidateId: string | undefined = body.candidateId;

    const { count } = await prisma.outreach.updateMany({
      where: {
        repliedAt: { not: null },
        replyRead: false,
        ...(candidateId ? { match: { candidateId } } : {}),
      },
      data: { replyRead: true },
    });

    return NextResponse.json({ ok: true, marked: count });
  } catch (err) {
    return apiError(err);
  }
}
