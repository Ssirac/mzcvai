import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import { resendEmptyLetters } from "@/services/outreach";
import { withCronLock } from "@/services/cron";

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

    // Apply runs DETACHED under a cron lock: a batch takes ~8 min, and Next
    // aborts route handlers when the HTTP client disconnects — earlier awaited
    // batches silently died with the proxy timeout. Kick the work off, answer
    // 202 immediately, and record the outcome (incl. failure reasons) in the
    // audit log when it finishes. The lock still serialises batches.
    const actor = authz.actor;
    if (apply) {
      void withCronLock("resend-empty", 10 * 60 * 1000, () => resendEmptyLetters(true, limit))
        .then(async (outcome) => {
          if (!outcome.ran || !outcome.result) return; // lock held — another batch runs
          const r = outcome.result;
          await logAudit({
            actor,
            action: "OUTREACH_SEND",
            targetType: "resend-empty",
            targetId: `resent:${r.resent}`,
            meta: {
              resent: r.resent,
              failed: r.failed,
              found: r.found,
              // First few failure reasons — enough to diagnose repeat offenders.
              failures: r.items
                .filter((i) => i.action.startsWith("failed"))
                .slice(0, 3)
                .map((i) => `${i.candidate}→${i.employer}: ${i.action.slice(0, 140)}`),
            },
          });
        })
        .catch(() => { /* logged inside the service */ });
      return NextResponse.json({ ok: true, started: true, limit }, { status: 202 });
    }

    const result = await resendEmptyLetters(false, limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
