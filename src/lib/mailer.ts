/**
 * Unified email sender.
 *
 * Railway (and many PaaS) block outbound SMTP ports (25/465/587) to prevent
 * spam, so raw SMTP times out. When RESEND_API_KEY is set we send via Resend's
 * HTTPS API (never blocked). Otherwise we fall back to SMTP via nodemailer for
 * local/self-hosted environments where SMTP egress is allowed.
 */

import nodemailer from "nodemailer";

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
  provider: "resend" | "smtp";
  id: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Send via Resend HTTPS API
async function sendViaResend(params: SendMailParams): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM || "info@mz-personalvermittlung.de";
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
    from: process.env.SMTP_FROM,
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
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(params);
  }
  return sendViaSmtp(params);
}
