import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

const ALLOWED = ["PENDING", "IN_PROGRESS", "SUBMITTED", "SKIPPED", "FAILED"];

// PATCH /api/captcha-queue/[id] — update status after an admin handles the item.
// Body: { status, resolvedBy? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { status, resolvedBy } = await req.json();
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const resolved = status === "SUBMITTED" || status === "SKIPPED" || status === "FAILED";
    await prisma.captchaQueue.update({
      where: { id: params.id },
      data: {
        status,
        resolvedBy: resolved ? (typeof resolvedBy === "string" ? resolvedBy : "admin") : null,
        resolvedAt: resolved ? new Date() : null,
      },
    });
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return apiError(err);
  }
}
