import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/captcha-queue/count — number of items awaiting robot confirmation.
// Drives the notification badge on the nav "Robot queue" tab.
export async function GET() {
  try {
    const count = await prisma.captchaQueue.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } });
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
