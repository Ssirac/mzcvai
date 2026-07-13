import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendingPause } from "@/services/deliverability";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + DB + mail provider + critical-config status.
 * PUBLIC (no auth), so it exposes ONLY booleans/enums — never secret values
 * (host/user/from/keys). Previously it leaked SMTP host/user/from; now redacted.
 */
export async function GET() {
  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch { /* db stays down */ }

  // Which mail transport is configured (booleans only, no values).
  const gmail = !!(process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  const resend = !!process.env.RESEND_API_KEY;
  const smtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const mailProvider = gmail ? "gmail" : resend ? "resend" : smtp ? "smtp" : "none";

  const config = {
    cronSecret: !!process.env.CRON_SECRET,
    sessionSecret: !!process.env.NEXTAUTH_SECRET,
    adminPassword: !!process.env.ADMIN_PASSWORD,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    databaseUrl: !!process.env.DATABASE_URL,
    testMode: !!process.env.OUTREACH_TEST_RECIPIENT,
  };

  // Deliverability pause snapshot (aggregate, no PII).
  let sending: { paused: boolean; reason: string | null; rate: number } | null = null;
  try {
    const p = await sendingPause();
    sending = { paused: p.paused, reason: p.reason, rate: Number(p.stats.rate.toFixed(3)) };
  } catch { /* ignore */ }

  const healthy = db === "up" && mailProvider !== "none" && config.cronSecret && config.sessionSecret;

  return NextResponse.json({
    status: healthy ? "ok" : "degraded",
    db,
    mailProvider,        // gmail | resend | smtp | none — no host/user/from
    mailConfigured: mailProvider !== "none",
    config,              // booleans only
    sending,
    time: new Date().toISOString(),
  });
}
