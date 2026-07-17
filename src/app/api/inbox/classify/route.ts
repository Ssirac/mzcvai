import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { authorize } from "@/lib/rbac";
import { classifyStoredReplies } from "@/services/replyClassifier";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/inbox/classify — backfill: AI-categorise stored replies that have
// no replyCategory yet (new replies are classified as they arrive in the
// poll). Batched; call repeatedly until remaining = 0.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;

    let limit = 25;
    try {
      const body = await req.json();
      if (Number.isFinite(body?.limit)) limit = Math.max(1, Math.min(50, body.limit));
    } catch { /* defaults */ }

    const result = await classifyStoredReplies(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
