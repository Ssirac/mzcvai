/**
 * Instant notification for important employer replies.
 *
 * When an employer answers and the reply is classified as a promising one
 * (interested / interview by default), email the operator right away so they
 * don't have to keep checking the inbox. Infrequent by nature — only the good
 * replies trigger it — so the extra send is negligible.
 *
 * Recipient resolution mirrors the daily digest: NOTIFY_TO → DIGEST_TO →
 * AGENCY_CONTACT_EMAIL → SMTP_USER. Disable with REPLY_NOTIFY_ENABLED=false;
 * widen the trigger set with REPLY_NOTIFY_CATEGORIES (comma-separated).
 * Fail-soft: any error is logged and swallowed — notifying must never block or
 * break reply capture.
 */

import type { ReplyCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { log } from "@/lib/log";

const DEFAULT_CATEGORIES: ReplyCategory[] = ["INTERESTED", "INTERVIEW"];

const CATEGORY_LABEL: Record<string, string> = {
  INTERESTED: "Interesse",
  INTERVIEW: "Vorstellungsgespräch",
  QUESTION: "Rückfrage",
  REJECTED: "Absage",
};

function recipient(): string {
  return (
    process.env.NOTIFY_TO ||
    process.env.DIGEST_TO ||
    process.env.AGENCY_CONTACT_EMAIL ||
    process.env.SMTP_USER ||
    ""
  );
}

function enabledCategories(): Set<string> {
  const raw = process.env.REPLY_NOTIFY_CATEGORIES;
  if (!raw) return new Set(DEFAULT_CATEGORIES);
  const parsed = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return parsed.length ? new Set(parsed) : new Set(DEFAULT_CATEGORIES);
}

export interface ImportantReplyInput {
  outreachId: string;
  category: ReplyCategory;
  candidateName: string | null;
  employerId: string | null;
  employerName?: string | null;
  subject: string;
  replyText: string;
}

export async function notifyImportantReply(input: ImportantReplyInput): Promise<void> {
  try {
    if (process.env.REPLY_NOTIFY_ENABLED === "false") return;
    if (!enabledCategories().has(input.category)) return;

    const to = recipient();
    if (!to) return; // no recipient configured — silently skip

    // Employer name isn't carried on the reply thread; look it up only now (rare).
    let employer = input.employerName ?? null;
    if (!employer && input.employerId) {
      employer = await prisma.employer
        .findUnique({ where: { id: input.employerId }, select: { name: true } })
        .then((e) => e?.name ?? null)
        .catch(() => null);
    }

    const label = CATEGORY_LABEL[input.category] ?? input.category;
    const base = process.env.SELF_URL || process.env.APP_URL || "https://mzcvai-production.up.railway.app";
    // Locale-prefixed link (the app routes are /az|de|en/…): a bare /inbox costs
    // an extra redirect and can drop the deep link on the login round-trip.
    const inboxUrl = `${base}/az/inbox`;
    const snippet = input.replyText.replace(/\s+/g, " ").trim().slice(0, 400);

    const lines = [
      `Neue Arbeitgeber-Antwort: ${label}`,
      "",
      `Arbeitgeber: ${employer || "—"}`,
      `Kandidat: ${input.candidateName || "—"}`,
      `Betreff: ${input.subject || "—"}`,
      "",
      snippet ? `„${snippet}${input.replyText.length > 400 ? "…" : ""}“` : "(kein Text)",
      "",
      `Im Posteingang öffnen: ${inboxUrl}`,
    ];

    await sendMail({
      to,
      subject: `${input.category === "INTERVIEW" ? "📅" : "🟢"} ${label}: ${employer || input.candidateName || "Arbeitgeber-Antwort"}`,
      text: lines.join("\n"),
    });
  } catch (err) {
    log.error("reply_notify.failed", { outreachId: input.outreachId, error: (err as Error).message });
  }
}
