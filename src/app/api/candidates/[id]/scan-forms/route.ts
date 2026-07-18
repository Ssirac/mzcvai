import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { authorize } from "@/lib/rbac";
import { runApplyScan } from "@/services/applyScanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/candidates/[id]/scan-forms — the "Formaları hazırla" button.
// Runs the human-in-the-loop apply scanner for THIS candidate's FORM matches:
// opens each application page, classifies it (plain form / captcha / OTP /
// login / dead), and enqueues the actionable ones to the robot queue so the
// recruiter can clear them with one click each. The scanner NEVER solves a
// captcha or submits a form — it only classifies and gathers.
//
// This exists because the background apply-scan is opt-in (APPLY_SCAN_ENABLED),
// so without it the robot queue stays empty even when a candidate has dozens of
// form-based matches. On demand, the recruiter fills the queue when they want.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;

    // Bound the run so the request never outlives maxDuration: cap the number of
    // pages and leave a margin under the 300s limit for the headless browser.
    const result = await runApplyScan({
      candidateId: params.id,
      limit: parseInt(process.env.APPLY_SCAN_LIMIT ?? "25"),
      maxMs: 240_000,
    });

    // "ready" = plain forms the extension can fill and the human just submits.
    const ready = result.form;
    const needsVerify = result.captcha + result.otp + result.login;
    return NextResponse.json({ ok: true, ...result, ready, needsVerify });
  } catch (err) {
    return apiError(err);
  }
}
