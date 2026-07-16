/**
 * Unified email sender.
 *
 * Railway (and many PaaS) block outbound SMTP ports (25/465/587) to prevent
 * spam, so raw SMTP times out. When RESEND_API_KEY is set we send via Resend's
 * HTTPS API (never blocked). Otherwise we fall back to SMTP via nodemailer for
 * local/self-hosted environments where SMTP egress is allowed.
 */

import nodemailer from "nodemailer";
import { AGENCY_NAME, brandedFrom } from "@/lib/brand";

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface SendMailParams {
  to: string | string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  provider: "resend" | "smtp" | "gmail";
  id: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send via the Gmail API (HTTPS — works on Railway where raw SMTP is blocked).
 * The mail genuinely comes FROM the Gmail account, so the recipient sees
 * germanycareercenter1@gmail.com as the sender.
 *
 * Requires (Railway env): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 * GMAIL_REFRESH_TOKEN (OAuth2, gmail.send scope), GMAIL_SENDER (the address).
 * Note: Google caps free-account sending (~100–500/day) and Resend
 * delivered/opened webhooks don't apply to Gmail-sent mail.
 */
async function sendViaGmail(params: SendMailParams): Promise<SendMailResult> {
  const clientId = process.env.GMAIL_CLIENT_ID!;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN!;
  const sender = process.env.GMAIL_SENDER || "germanycareercenter1@gmail.com";
  const fromName = AGENCY_NAME;

  // 1) Refresh token → short-lived access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Gmail OAuth failed: ${tokenData.error_description || tokenRes.status}`);
  }

  // 2) Build the raw RFC822 message (nodemailer's streamTransport composes
  //    without sending — gives us the full MIME incl. the CV attachment).
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const composed = await composer.sendMail({
    from: `${fromName} <${sender}>`,
    to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
    replyTo: process.env.REPLY_TO || process.env.MAIL_REPLY_TO || undefined,
    bcc: process.env.MAIL_BCC || undefined,
    subject: params.subject,
    text: params.text,
    attachments: params.attachments,
  });
  const raw = (composed.message as Buffer).toString("base64url");

  // 3) Send through the Gmail API
  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const sendData = (await sendRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!sendRes.ok) {
    throw new Error(`Gmail send failed: ${sendData.error?.message || sendRes.status}`);
  }
  return { provider: "gmail", id: sendData.id ?? null };
}

// Send via Resend HTTPS API
async function sendViaResend(params: SendMailParams): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY!;
  // Always brand the sender NAME as "MZ Talent Solutions", keeping whatever
  // address MAIL_FROM/SMTP_FROM specifies (defaults to the IONOS address).
  const from = brandedFrom(process.env.MAIL_FROM || process.env.SMTP_FROM, "info@mz-personalvermittlung.de");
  const to = Array.isArray(params.to) ? params.to : [params.to];

  const body: Record<string, unknown> = {
    from,
    to,
    subject: params.subject,
    text: params.text,
  };

  // Employer replies should land in a real inbox you watch (IONOS). Defaults to
  // the from-address; override with REPLY_TO.
  const replyTo = process.env.REPLY_TO || process.env.MAIL_REPLY_TO;
  if (replyTo) body.reply_to = replyTo;

  // Optional self-copy so every sent application also shows up in your own inbox
  // (Resend bypasses IONOS, so the IONOS "Sent" folder stays empty otherwise).
  const bcc = process.env.MAIL_BCC;
  if (bcc) body.bcc = bcc.split(",").map((s) => s.trim()).filter(Boolean);

  if (params.attachments && params.attachments.length > 0) {
    body.attachments = params.attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    }));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string }).message || `Resend API error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return { provider: "resend", id: (data as { id?: string }).id ?? null };
}

// Send via SMTP (nodemailer). Port 465 ⇒ implicit SSL.
async function sendViaSmtp(params: SendMailParams): Promise<SendMailResult> {
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from: brandedFrom(process.env.SMTP_FROM, process.env.SMTP_USER || "info@mz-personalvermittlung.de"),
    to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
    replyTo: process.env.REPLY_TO || process.env.MAIL_REPLY_TO || undefined,
    bcc: process.env.MAIL_BCC || undefined,
    subject: params.subject,
    text: params.text,
    attachments: params.attachments,
  });

  return { provider: "smtp", id: info.messageId ?? null };
}

export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
  // Gmail API first when configured — mail then really comes FROM the Gmail
  // address. Falls back to Resend, then raw SMTP.
  if (process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return sendViaGmail(params);
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(params);
  }
  return sendViaSmtp(params);
}
