import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// POST /api/matches/[id]/feedback — recruiter marks a match GOOD or BAD (or clears
// it). Stored on the Match to inform future scoring; who/when is recorded.
// Body: { verdict: "GOOD" | "BAD" | null, note? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { verdict, note } = await req.json();
    if (verdict !== "GOOD" && verdict !== "BAD" && verdict !== null) {
      return NextResponse.json({ error: "verdict must be GOOD, BAD or null" }, { status: 400 });
    }
    const actor = await getSessionUser(req);
    await prisma.match.update({
      where: { id: params.id },
      data: {
        feedback: verdict,
        feedbackNote: verdict ? (typeof note === "string" ? note : null) : null,
        feedbackBy: verdict ? (actor ?? "unknown") : null,
        feedbackAt: verdict ? new Date() : null,
      },
    });
    return NextResponse.json({ ok: true, feedback: verdict });
  } catch (err) {
    return apiError(err);
  }
}
