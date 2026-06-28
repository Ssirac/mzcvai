import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/health — liveness + DB connectivity + env config check.
export async function GET() {
  let db: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch { /* db stays down */ }

  const smtpHost = process.env.SMTP_HOST || null;
  const smtpUser = process.env.SMTP_USER || null;
  const smtpPass = process.env.SMTP_PASS || null;
  const smtpFrom = process.env.SMTP_FROM || null;
  const testRecipient = process.env.OUTREACH_TEST_RECIPIENT || null;

  return NextResponse.json({
    status: db === "up" ? "ok" : "degraded",
    db,
    smtp: {
      host: smtpHost,
      port: process.env.SMTP_PORT || "587",
      user: smtpUser,
      passSet: !!smtpPass,
      from: smtpFrom,
    },
    testRecipient,
    time: new Date().toISOString(),
  });
}
