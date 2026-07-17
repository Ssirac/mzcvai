import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import { resendEmptyLetters } from "@/services/outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/admin/resend-empty — one-off repair: re-send the applications that
// went out with an EMPTY AI body (13–14 July Sonnet-5 thinking-block bug).
// Body: { apply?: boolean, limit?: number }. Dry-run by default. Each letter is
// regenerated (composer now throws on short bodies) and sent on the SAME
// outreach row, so reply codes and follow-ups stay intact. Batched: regenerating
// a letter takes ~10s, so call repeatedly with a modest limit until found=0.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;

    let apply = false;
    let limit = 12;
    try {
      const body = await req.json();
      apply = !!body?.apply;
      if (Number.isFinite(body?.limit)) limit = Math.max(1, Math.min(20, body.limit));
    } catch { /* no body → dry-run */ }

    const result = await resendEmptyLetters(apply, limit);

    if (apply && result.resent > 0) {
      await logAudit({
        actor: authz.actor,
        action: "OUTREACH_SEND",
        targetType: "resend-empty",
        targetId: `resent:${result.resent}`,
        meta: { resent: result.resent, failed: result.failed, found: result.found },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
