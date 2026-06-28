import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { CV_INSTRUCTION, parseCvContent } from "@/lib/cvParser";

export const maxDuration = 90;

// POST /api/candidates/parse-cv
// multipart/form-data with field "file" = PDF CV.
// Claude reads the PDF (all pages) and returns structured candidate fields.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded (field 'file')" }, { status: 400 });
    }

    const blob = file as File;
    if (blob.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }
    if (blob.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF too large (max 20 MB)" }, { status: 400 });
    }

    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

    // Same exhaustive instruction as the paste-text path, applied to the PDF.
    const data = await parseCvContent([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: CV_INSTRUCTION },
    ]);

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[/api/candidates/parse-cv]", err);
    return apiError(err);
  }
}
