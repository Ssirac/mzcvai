import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/candidates/[id]/cv — download the candidate's stored CV file.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await prisma.candidate.findUnique({
    where: { id: params.id },
    select: { cvData: true, cvFileName: true, cvMimeType: true },
  });
  if (!c?.cvData) {
    return NextResponse.json({ error: "No CV on file" }, { status: 404 });
  }
  const bytes = new Uint8Array(c.cvData);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": c.cvMimeType || "application/pdf",
      "Content-Disposition": `inline; filename="${(c.cvFileName || "cv.pdf").replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
    },
  });
}
