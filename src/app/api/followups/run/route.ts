import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { runFollowUps } from "@/services/followup";

export const maxDuration = 300;

// POST /api/followups/run — manually trigger the follow-up sequence (also runs
// nightly). Sends only when FOLLOWUPS_ENABLED=true; otherwise reports a dry run.
export async function POST() {
  try {
    const result = await runFollowUps();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
