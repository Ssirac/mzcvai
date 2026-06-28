import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { CV_INSTRUCTION, parseCvContent } from "@/lib/cvParser";

export const maxDuration = 60;

// POST /api/candidates/parse-text
// Body: { text: string } — a pasted CV. Claude extracts structured fields.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }
    const { text } = await req.json();
    if (typeof text !== "string" || text.trim().length < 20) {
      return NextResponse.json({ error: "Provide CV text (min 20 chars)" }, { status: 400 });
    }
    if (text.length > 30000) {
      return NextResponse.json({ error: "Text too long (max 30000 chars)" }, { status: 400 });
    }

    const data = await parseCvContent(`${CV_INSTRUCTION}\n\nLebenslauf:\n"""\n${text}\n"""`);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return apiError(err);
  }
}
