import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { sweepDeadVacancies } from "@/services/scraper/deadCheck";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/vacancies/sweep-dead — manual "delete dead listings" trigger for the
 * candidates page button. Checks ACTIVE vacancy URLs across ALL sources (not just
 * stale ones) and removes the dead ones, within a ~4.5 min budget so the request
 * completes. Visiting URLs is slow, so it processes as many as it can per click —
 * the returned `checked`/`deleted` tell the user; click again to continue.
 */
export async function POST() {
  try {
    const result = await sweepDeadVacancies({
      limit: 400,
      notSeenMins: 0,   // check everything, not only stale rows
      delayMs: 300,
      maxMs: 260_000,   // stay within maxDuration
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
