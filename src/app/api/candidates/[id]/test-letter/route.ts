import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { sendCandidateTestLetter } from "@/services/outreach";

export const maxDuration = 120;

// POST /api/candidates/[id]/test-letter
// Body: { recipients: string[] } — sends a CV-tailored motivation letter (TEST)
// with the candidate's CV attached, to the given addresses.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const recipients: string[] = Array.isArray(body.recipients)
      ? body.recipients.filter((r: unknown) => typeof r === "string" && /\S+@\S+\.\S+/.test(r))
      : [];
    if (recipients.length === 0) {
      return NextResponse.json({ error: "recipients (valid emails) required" }, { status: 400 });
    }
    const result = await sendCandidateTestLetter(params.id, recipients);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
