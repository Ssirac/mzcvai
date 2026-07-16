import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { sendAllForCandidate } from "@/services/outreach";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";

export const maxDuration = 300;

// POST /api/candidates/[id]/send-all
// Bulk outreach to every matching employer for this candidate. Respects the
// daily cap, per-employer cooldown and generic-email-only rules.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "outreach.bulk");
    if (!authz.ok) return authz.response;
    const body = await req.json().catch(() => ({}));
    // Approver = the logged-in user (recorded on every outreach), not client input.
    // Already resolved by authorize(); reuse it rather than re-verifying the cookie.
    const actor = authz.actor;
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
