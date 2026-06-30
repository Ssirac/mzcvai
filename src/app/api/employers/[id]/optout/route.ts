import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

// POST /api/employers/[id]/optout  { optedOut?: boolean }
// Manually flag an employer as do-not-contact (or undo). No further application
// or follow-up is sent to an opted-out employer.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const optedOut = body.optedOut !== false; // default true
    await prisma.employer.update({ where: { id: params.id }, data: { optedOut } });
    return NextResponse.json({ ok: true, optedOut });
  } catch (err) {
    return apiError(err);
  }
}
