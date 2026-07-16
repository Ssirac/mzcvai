import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { deleteExpiredVacancies } from "@/services/cleanup";
import { authorize } from "@/lib/rbac";

// POST /api/cleanup-expired
// Manual trigger to delete stale (30+ day) job postings now. The same purge runs
// automatically every hour (maintenance cron) and nightly, so the DB stays
// current without any clicking. Listings tied to a SENT outreach are kept.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    const result = await deleteExpiredVacancies();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
