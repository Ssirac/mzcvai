import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { mergeDuplicateEmployers } from "@/services/dedup";
import { authorize } from "@/lib/rbac";

export const maxDuration = 120;

// POST /api/dedup-employers — merge duplicate employers now (also runs nightly).
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    const result = await mergeDuplicateEmployers();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
