import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { sendAllForCandidate } from "@/services/outreach";

export const maxDuration = 300;

// POST /api/candidates/[id]/send-all
// Bulk outreach to every matching employer for this candidate. Respects the
// daily cap, per-employer cooldown and generic-email-only rules.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const approvedBy = typeof body.userId === "string" ? body.userId : "bulk-send";
    const result = await sendAllForCandidate(params.id, approvedBy);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
