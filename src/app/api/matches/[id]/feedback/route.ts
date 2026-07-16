import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/rbac";
import type { FeedbackReason } from "@prisma/client";

const REASONS: FeedbackReason[] = ["SKILL_MISMATCH", "SALARY", "LOCATION", "VISA", "LANGUAGE", "OVERQUALIFIED", "OTHER"];

// POST /api/matches/[id]/feedback — recruiter marks a match GOOD or BAD (or clears
// it). Stored on the Match to inform future scoring; who/when is recorded.
// Body: { verdict: "GOOD" | "BAD" | null, reason?, note? }
// `reason` is a structured "why bad" category (only kept for BAD).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;
    const { verdict, reason, note } = await req.json();
    if (verdict !== "GOOD" && verdict !== "BAD" && verdict !== null) {
      return NextResponse.json({ error: "verdict must be GOOD, BAD or null" }, { status: 400 });
    }
    const feedbackReason: FeedbackReason | null =
      verdict === "BAD" && REASONS.includes(reason) ? reason : null;

    await prisma.match.update({
      where: { id: params.id },
      data: {
        feedback: verdict,
        feedbackReason,
        feedbackNote: verdict ? (typeof note === "string" ? note : null) : null,
        feedbackBy: verdict ? (authz.actor ?? "unknown") : null,
        feedbackAt: verdict ? new Date() : null,
      },
    });
    return NextResponse.json({ ok: true, feedback: verdict, reason: feedbackReason });
  } catch (err) {
    return apiError(err);
  }
}
