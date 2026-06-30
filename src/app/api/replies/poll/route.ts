import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { pollReplies } from "@/services/replies";

export const maxDuration = 120;

// POST /api/replies/poll — manually run the IMAP reply detection (also runs
// nightly). Returns how many replies were matched to outreach.
export async function POST() {
  try {
    const result = await pollReplies();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
