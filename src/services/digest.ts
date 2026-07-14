/**
 * Daily digest — a short "what needs you today" email to the operator, so they
 * don't have to open the app to know if anything is waiting. Sent once a day by
 * the scheduler. Recipient: DIGEST_TO (falls back to the agency contact email).
 * Disable with DAILY_DIGEST_ENABLED=false.
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";

export interface DigestResult {
  sent: boolean;
  to?: string;
  reason?: string;
  counts?: Record<string, number>;
}

export async function sendDailyDigest(): Promise<DigestResult> {
  if (process.env.DAILY_DIGEST_ENABLED === "false") return { sent: false, reason: "disabled" };
  const to =
    process.env.DIGEST_TO ||
    process.env.AGENCY_CONTACT_EMAIL ||
    process.env.SMTP_USER ||
    "";
  if (!to) return { sent: false, reason: "no recipient (set DIGEST_TO)" };

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [unanswered, queue, interviews, sentYesterday, repliesYesterday] = await Promise.all([
    prisma.outreach.count({ where: { repliedAt: { not: null }, outboundReplies: { none: {} } } }),
    prisma.captchaQueue.findMany({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } }, select: { blockedReason: true } }),
    prisma.match.count({ where: { status: "INTERVIEW" } }),
    prisma.outreach.count({ where: { sentAt: { gte: dayAgo } } }),
    prisma.outreach.count({ where: { repliedAt: { gte: dayAgo } } }),
  ]);

  const queueReady = queue.filter((q) => /form/i.test(q.blockedReason || "")).length;
  const queueVerify = queue.length - queueReady;

  const counts = {
    unanswered, queueReady, queueVerify, interviews, sentYesterday, repliesYesterday,
  };

  // Nothing actionable and nothing happened → skip (no noise).
  if (unanswered === 0 && queue.length === 0 && interviews === 0 && sentYesterday === 0 && repliesYesterday === 0) {
    return { sent: false, reason: "nothing to report", counts };
  }

  const base = process.env.SELF_URL || process.env.APP_URL || "https://mzcvai-production.up.railway.app";
  const lines = [
    "Guten Morgen,",
    "",
    "Ihr MZ-Tagesüberblick:",
    "",
    `• ${unanswered} Arbeitgeber-Antwort(en) warten auf Ihre Rückmeldung`,
    `• ${queueReady} ausfüllbereite Formulare + ${queueVerify} mit Captcha/OTP in der Roboter-Warteschlange`,
    `• ${interviews} Kandidat(en) im Vorstellungsgespräch`,
    "",
    "Letzte 24 Stunden:",
    `• ${sentYesterday} Bewerbung(en) versendet`,
    `• ${repliesYesterday} neue Antwort(en) erhalten`,
    "",
    `Öffnen: ${base}`,
  ];

  try {
    await sendMail({ to, subject: `MZ Tagesüberblick — ${unanswered} Antwort(en), ${queue.length} in der Warteschlange`, text: lines.join("\n") });
    return { sent: true, to, counts };
  } catch (e) {
    return { sent: false, reason: (e as Error).message, counts };
  }
}
