import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

// GET /api/health — liveness + DB + SMTP connectivity check.
export async function GET() {
  let db: "up" | "down" = "down";
  let smtp: "ok" | "error" | "not_configured" = "not_configured";
  let smtpError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch { /* db stays down */ }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: false,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
      });
      await transporter.verify();
      smtp = "ok";
    } catch (err) {
      smtp = "error";
      smtpError = (err as Error).message;
    }
  }

  return NextResponse.json({
    status: db === "up" && smtp === "ok" ? "ok" : "degraded",
    db,
    smtp,
    smtpHost: host ?? null,
    smtpUser: user ? user.replace(/(?<=.{3}).+(?=@)/, "***") : null,
    smtpError,
    testRecipient: process.env.OUTREACH_TEST_RECIPIENT || null,
    time: new Date().toISOString(),
  });
}
