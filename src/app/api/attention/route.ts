import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/attention — the "needs my attention today" summary for the dashboard:
// employer replies we haven't answered, robot-queue jobs to handle (ready vs
// captcha/OTP), and candidates at interview/offer stage.
export async function GET() {
  try {
    const [unansweredReplies, queue, interviews] = await Promise.all([
      // Employer replied but we haven't sent an answer back yet.
      prisma.outreach.count({
        where: { repliedAt: { not: null }, outboundReplies: { none: {} } },
      }),
      // Pending robot-queue items, split by whether they need a human check.
      prisma.captchaQueue.findMany({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
        select: { blockedReason: true },
      }),
      // Candidates advanced to the interview stage.
      prisma.match.count({ where: { status: "INTERVIEW" } }),
    ]);

    const queueReady = queue.filter((q) => /form/i.test(q.blockedReason || "")).length;
    const queueVerify = queue.length - queueReady;

    return NextResponse.json({
      unansweredReplies,
      queueReady,
      queueVerify,
      queueTotal: queue.length,
      interviews,
    });
  } catch (err) {
    return apiError(err);
  }
}
