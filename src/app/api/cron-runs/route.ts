import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/cron-runs?limit= — recent cron-run history (newest first) for the
// System admin page: job, status, duration, error.
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") || "60"), 200);
    const items = await prisma.cronRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, job: true, status: true, startedAt: true, durationMs: true, error: true },
    });
    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    return apiError(err);
  }
}
