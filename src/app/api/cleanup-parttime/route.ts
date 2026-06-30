import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { deletePartTimeVacancies } from "@/services/cleanup";

// POST /api/cleanup-parttime
// Manual trigger (dashboard button) to delete existing part-time / mini-job
// vacancies now. The same purge also runs automatically every hour via the
// maintenance cron, so the DB stays full-time-only without any clicking.
export async function POST() {
  try {
    const result = await deletePartTimeVacancies();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
