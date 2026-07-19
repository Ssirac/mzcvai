import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { scanUnmatchedReplies } from "@/services/replies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/inbox/unmatched — replies sitting in the mailbox that came from an
// employer we contacted but couldn't be auto-linked to a candidate (they
// answered from a different address, the subject lost the tracking code, …).
// Read-only IMAP scan so no genuine reply is ever invisible. Opens a socket, so
// it's a manual action (not polled).
export async function GET() {
  try {
    const result = await scanUnmatchedReplies(parseInt(process.env.UNMATCHED_SCAN_DAYS ?? "14"));
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
