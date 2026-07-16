import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { deletePartTimeVacancies, deleteNonGermanVacancies } from "@/services/cleanup";
import { authorize } from "@/lib/rbac";

// POST /api/cleanup-parttime
// Manual trigger (dashboard button) to delete existing part-time / mini-job AND
// non-German vacancies now. The same purges also run automatically every hour
// via the maintenance cron, so the DB stays full-time, Germany-only without any
// clicking.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    const result = await deletePartTimeVacancies();
    const nonGerman = await deleteNonGermanVacancies();
    return NextResponse.json({ ok: true, ...result, ...nonGerman });
  } catch (err) {
    return apiError(err);
  }
}
