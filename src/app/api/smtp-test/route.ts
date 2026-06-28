import { NextRequest, NextResponse } from "next/server";
import { sendMail } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/smtp-test?to=you@example.com
// Bare mail check: NO Claude, NO PDF, NO DB. Sends one plain email via the
// configured provider (Resend if RESEND_API_KEY is set, else SMTP). Isolates
// whether email delivery itself works.
export async function GET(req: NextRequest) {
  const to = new URL(req.url).searchParams.get("to");
  if (!to || !/\S+@\S+\.\S+/.test(to)) {
    return NextResponse.json({ error: "Add ?to=your@email.com" }, { status: 400 });
  }

  const provider = process.env.RESEND_API_KEY ? "resend" : "smtp";
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "(missing)";

  try {
    const result = await sendMail({
      to,
      subject: "MZ Mail Test",
      text: "Bu, MZ sisteminin test mailidir. Bu maili aldınızsa, göndərmə işləyir.",
    });
    return NextResponse.json({ ok: true, provider: result.provider, id: result.id, from });
  } catch (err) {
    return NextResponse.json(
      { ok: false, provider, from, error: (err as Error).message },
      { status: 500 }
    );
  }
}
