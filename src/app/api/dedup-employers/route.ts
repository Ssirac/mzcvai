import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { mergeDuplicateEmployers } from "@/services/dedup";

export const maxDuration = 120;

// POST /api/dedup-employers — merge duplicate employers now (also runs nightly).
export async function POST() {
  try {
    const result = await mergeDuplicateEmployers();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
