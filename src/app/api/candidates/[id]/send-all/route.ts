import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { sendAllForCandidate } from "@/services/outreach";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";

export const maxDuration = 300;

// POST /api/candidates/[id]/send-all
// Bulk outreach to every matching employer for this candidate. Respects the
// daily cap, per-employer cooldown and generic-email-only rules.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    // Approver = the logged-in user (recorded on every outreach), not client input.
    const actor = await getSessionUser(req);
    const matchIds = Array.isArray(body.matchIds)
      ? body.matchIds.filter((x: unknown): x is string => typeof x === "string")
      : undefined;
    const result = await sendAllForCandidate(params.id, actor ?? "bulk-send", matchIds);
    await logAudit({ actor, action: "OUTREACH_SEND", targetType: "candidate", targetId: params.id, meta: { sent: result.sent, bulk: true } });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
