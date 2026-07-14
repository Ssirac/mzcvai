import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import { reconcileReplies } from "@/services/replies";

export const maxDuration = 120;

// POST /api/replies/reconcile — one-off repair for replies attached to the wrong
// candidate before subject-code/name matching existed. Dry-run by default;
// body { apply: true } writes the moves. Session-protected by middleware.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    let apply = false;
    try { apply = !!(await req.json())?.apply; } catch { /* no body → dry-run */ }

    const result = await reconcileReplies(apply);

    if (apply && result.reassigned > 0) {
      const actor = await getSessionUser(req);
      await logAudit({ actor, action: "OUTREACH_SEND", targetType: "reconcile", targetId: `replies:${result.reassigned}`, meta: { reassigned: result.reassigned, conflicts: result.conflicts } });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
