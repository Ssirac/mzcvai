import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { authorize } from "@/lib/rbac";
import { logAudit } from "@/services/audit";
import { runAutoApply } from "@/services/autoApply";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/auto-apply — run the form auto-apply engine ON DEMAND so you can
 * see exactly what it would submit, without waiting for the 6-hourly cron.
 *
 * DRY-RUN ALWAYS (this endpoint can never submit for real): it forces the engine
 * on and dry-run on, regardless of the AUTO_FORM_APPLY_* env flags. It fills each
 * FORM match in a headless browser and reports — captcha/OTP/login and any form
 * with a missing required field are routed to the human queue exactly as in a
 * real run. Real submission is only ever enabled via AUTO_FORM_APPLY_DRY_RUN=false
 * on the scheduled run, never here.
 *
 * Body (optional): { candidateId?: string, limit?: number }. Keep the limit small
 * (headless browsing is slow); default 5.
 */
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;

    let candidateId: string | undefined;
    let limit = 5;
    try {
      const body = await req.json();
      if (typeof body?.candidateId === "string") candidateId = body.candidateId;
      if (Number.isFinite(body?.limit)) limit = Math.max(1, Math.min(10, body.limit));
    } catch { /* no body → defaults */ }

    const result = await runAutoApply({
      candidateId,
      limit,
      maxMs: 100 * 1000,
      forceEnabled: true, // run even if AUTO_FORM_APPLY_ENABLED is unset
      forceDryRun: true,  // and NEVER submit from this test endpoint
    });

    await logAudit({
      actor: authz.actor,
      action: "OUTREACH_SEND",
      targetType: "auto-apply-dryrun",
      targetId: `wouldSubmit:${result.wouldSubmit}`,
      meta: {
        scanned: result.scanned, wouldSubmit: result.wouldSubmit,
        queuedForHuman: result.queuedForHuman, noForm: result.noForm,
        firecrawlRecovered: result.firecrawlRecovered, llmMapped: result.llmMapped,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, ...result }); // result.dryRun is true (forced)
  } catch (err) {
    return apiError(err);
  }
}
