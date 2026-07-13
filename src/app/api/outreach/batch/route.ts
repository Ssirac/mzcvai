import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { approveOutreach, sendOutreach } from "@/services/outreach";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

/**
 * POST /api/outreach/batch — act on several outreach records at once.
 *
 * Powers the Review panel's bulk buttons. Every send still goes through the
 * unchanged safety guards in sendOutreach (human approval, daily/global caps,
 * per-candidate cooldown, opt-out, generic-email-only) — so a bulk action can
 * never bypass a rule; ineligible items just come back with an error.
 *
 * Body: { ids: string[], action: "approve" | "send" | "approve-and-send", userId? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
    const action: string = body.action;
    // Actor = the logged-in user, recorded as approver on each outreach.
    const userId: string = (await getSessionUser(req)) ?? "review-panel";

    if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
    if (!["approve", "send", "approve-and-send"].includes(action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const summary = { approved: 0, sent: 0, failed: 0 };
    const results: { id: string; ok: boolean; status?: string; error?: string }[] = [];

    for (const id of ids) {
      try {
        if (action === "approve" || action === "approve-and-send") {
          const cur = await prisma.outreach.findUnique({ where: { id }, select: { status: true } });
          if (cur?.status === "DRAFT") { await approveOutreach(id, userId); summary.approved++; }
        }
        if (action === "send" || action === "approve-and-send") {
          await sendOutreach(id);
          summary.sent++;
          results.push({ id, ok: true, status: "SENT" });
          continue;
        }
        results.push({ id, ok: true, status: "APPROVED" });
      } catch (err) {
        summary.failed++;
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }

    await logAudit({ actor: userId, action: action === "send" || action === "approve-and-send" ? "OUTREACH_SEND" : "OUTREACH_APPROVE", meta: { ...summary, ids: ids.length } });
    return NextResponse.json({ ok: true, action, ...summary, results });
  } catch (err) {
    return apiError(err);
  }
}
