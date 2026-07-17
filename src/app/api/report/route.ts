import { NextRequest, NextResponse } from "next/server";
import type { ReplyCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Resolve a "YYYY-MM" string (or the current month) into a UTC [start, end) range.
function monthRange(month: string | null): { key: string; start: Date; end: Date } {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based
  const parsed = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  if (parsed) {
    const [yy, mm] = parsed.split("-").map(Number);
    if (yy >= 2000 && yy <= 2999 && mm >= 1 && mm <= 12) { y = yy; m = mm - 1; }
  }
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const key = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { key, start, end };
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const POSITIVE: ReplyCategory[] = ["INTERESTED", "INTERVIEW"];

async function monthStats(start: Date, end: Date) {
  const inRange = { gte: start, lt: end };
  const [sent, replies, positiveReplies, interviews, newCandidates, placements] = await Promise.all([
    prisma.outreach.count({ where: { sentAt: inRange } }),
    prisma.outreach.count({ where: { repliedAt: inRange } }),
    prisma.outreach.count({ where: { repliedAt: inRange, replyCategory: { in: POSITIVE } } }),
    prisma.pipelineEvent.count({ where: { toStage: "INTERVIEW", createdAt: inRange } }),
    prisma.candidate.count({ where: { createdAt: inRange } }),
    prisma.pipelineEvent.count({ where: { toStage: "PLACED", createdAt: inRange } }),
  ]);
  const replyRate = sent > 0 ? Math.round((replies / sent) * 1000) / 10 : 0;
  return { sent, replies, positiveReplies, interviews, newCandidates, placements, replyRate };
}

// GET /api/report?month=YYYY-MM — a month's activity summary (applications sent,
// replies, promising replies, new candidates, interviews, placements) plus the
// same figures for the previous month for a quick trend. Client-presentable.
export async function GET(req: NextRequest) {
  try {
    const { key, start, end } = monthRange(req.nextUrl.searchParams.get("month"));
    const prevKey = shiftMonth(key, -1);
    const prev = monthRange(prevKey);

    const [current, previous, activeCandidates] = await Promise.all([
      monthStats(start, end),
      monthStats(prev.start, prev.end),
      prisma.candidate.count({ where: { status: "ACTIVE" } }),
    ]);

    // Current month is only "complete" if it's in the past.
    const now = new Date();
    const isCurrentMonth = key === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    return NextResponse.json({
      month: key,
      prevMonth: prevKey,
      nextMonth: isCurrentMonth ? null : shiftMonth(key, 1),
      isCurrentMonth,
      activeCandidates,
      current,
      previous,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
