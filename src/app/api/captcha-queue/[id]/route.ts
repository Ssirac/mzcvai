import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";

const ALLOWED = ["PENDING", "IN_PROGRESS", "SUBMITTED", "SKIPPED", "FAILED"];

// captcha-queue status → JobApplicationLog status (keep the two in sync so the
// Applications log reflects what the admin did in the robot queue).
const LOG_STATUS: Record<string, string> = {
  SUBMITTED: "APPLIED",
  SKIPPED: "SKIPPED",
  FAILED: "ERROR",
};

// PATCH /api/captcha-queue/[id] — update status after an admin handles the item.
// Body: { status }. Also mirrors the status onto the JobApplicationLog row for
// the same (candidate, job), so "Submitted" shows as APPLIED in the log.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { status } = await req.json();
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const actor = await getSessionUser(req);
    const resolved = status === "SUBMITTED" || status === "SKIPPED" || status === "FAILED";

    const row = await prisma.captchaQueue.update({
      where: { id: params.id },
      data: {
        status,
        resolvedBy: resolved ? (actor ?? "admin") : null,
        resolvedAt: resolved ? new Date() : null,
      },
      select: { candidateId: true, jobId: true },
    });

    // Mirror onto the application log (best-effort — the row may not exist).
    const logStatus = LOG_STATUS[status];
    if (logStatus) {
      await prisma.jobApplicationLog.updateMany({
        where: { candidateId: row.candidateId, vacancyId: row.jobId },
        data: { status: logStatus },
      }).catch(() => {});
      if (status === "SUBMITTED") {
        await logAudit({ actor, action: "OUTREACH_SEND", targetType: "application", targetId: `${row.candidateId}:${row.jobId}`, meta: { manual: true } });
      }
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return apiError(err);
  }
}
