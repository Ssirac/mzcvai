import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/smtp-test?to=you@example.com
// Bare-bones SMTP check: NO Claude, NO PDF, NO DB. Just connects to the SMTP
// server and sends one plain email. Isolates whether email delivery itself works.
export async function GET(req: NextRequest) {
  const to = new URL(req.url).searchParams.get("to");
  if (!to || !/\S+@\S+\.\S+/.test(to)) {
    return NextResponse.json({ error: "Add ?to=your@email.com" }, { status: 400 });
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user;

  const config = {
    host: host ?? "(missing)",
    port,
    secure: port === 465,
    user: user ?? "(missing)",
    passSet: !!pass,
    from: from ?? "(missing)",
  };

  if (!host || !user || !pass) {
    return NextResponse.json({ ok: false, step: "config", error: "SMTP_HOST/USER/PASS not all set", config }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: false },
  });

  // Step 1: verify connection/auth
  try {
    await transporter.verify();
  } catch (err) {
    return NextResponse.json(
      { ok: false, step: "verify", error: (err as Error).message, config },
      { status: 500 }
    );
  }

  // Step 2: send a plain email
  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: "MZ SMTP Test",
      text: "Bu, MZ sisteminin SMTP test mailidir. Bu maili aldınızsa, göndərmə işləyir.",
    });
    return NextResponse.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, config });
  } catch (err) {
    return NextResponse.json(
      { ok: false, step: "send", error: (err as Error).message, config },
      { status: 500 }
    );
  }
}
