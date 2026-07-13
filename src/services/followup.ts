/**
 * Follow-up sequence — the single biggest lever on reply rate. Most employer
 * responses come from the 2nd/3rd touch, not the first. This sends a short,
 * polite reminder for applications that haven't been answered after a delay,
 * up to a small cap, then stops.
 *
 * Strictly suppressed when the thread is already REPLIED or BOUNCED, so an
 * employer who answered never gets a reminder. Run from the nightly cron.
 *
 * Config (env):
 *   FOLLOWUP_DAYS         days to wait before each follow-up (default 3)
 *   FOLLOWUP_MAX          max follow-ups per application (default 2)
 *   FOLLOWUP_BATCH        max follow-ups sent per run (default 40)
 *   FOLLOWUPS_ENABLED     must be "true" to actually send (safety switch)
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { agencySignature, complianceFooter } from "@/services/outreach";
import { generateCandidateCvPdf, cvFileName } from "@/services/cvPdf";

export interface FollowUpResult {
  eligible: number;
  sent: number;
  skipped: number;
  errors: string[];
}

function followUpBody(candidateName: string, employerName: string, position: string, sentAt: Date): string {
  const dateStr = sentAt.toLocaleDateString("de-DE");
  return [
    "Sehr geehrte Damen und Herren,",
    "",
    `ich komme höflich auf meine Bewerbung vom ${dateStr} für ${candidateName} als ${position}${employerName ? ` bei ${employerName}` : ""} zurück.`,
    "",
    "Über eine kurze Rückmeldung, ob die Unterlagen angekommen sind und ob grundsätzliches Interesse besteht, würde ich mich sehr freuen. Selbstverständlich stehe ich für Rückfragen oder ein kurzes, unverbindliches Online-Vorstellungsgespräch jederzeit gern zur Verfügung.",
    "",
    agencySignature(candidateName),
  ].join("\n");
}

export async function runFollowUps(): Promise<FollowUpResult> {
  const result: FollowUpResult = { eligible: 0, sent: 0, skipped: 0, errors: [] };

  const days = parseInt(process.env.FOLLOWUP_DAYS || "3");
  const maxFollowUps = parseInt(process.env.FOLLOWUP_MAX || "2");
  const batch = parseInt(process.env.FOLLOWUP_BATCH || "40");
  const enabled = process.env.FOLLOWUPS_ENABLED === "true";

  const waitCutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Eligible: sent or opened (NOT replied/bounced), last touch older than the
  // wait window, under the follow-up cap, and we have an address to write to.
  const eligible = await prisma.outreach.findMany({
    where: {
      status: { in: ["SENT", "OPENED"] },
      toAddress: { not: null },
      followUpCount: { lt: maxFollowUps },
      sentAt: { not: null, lte: waitCutoff },
      OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lte: waitCutoff } }],
    },
    select: {
      id: true, toAddress: true, subject: true, sentAt: true, followUpCount: true,
      match: {
        select: {
          employerId: true,
          candidate: { select: { id: true, name: true, cvData: true, cvFileName: true } },
          employer: { select: { name: true, optedOut: true } },
          vacancy: { select: { title: true, beruf: true } },
        },
      },
    },
    orderBy: { sentAt: "asc" },
    take: batch,
  });

  result.eligible = eligible.length;

  if (!enabled) {
    // Dry run — report how many WOULD be sent without sending anything.
    result.skipped = eligible.length;
    result.errors.push("FOLLOWUPS_ENABLED is not 'true' — dry run, nothing sent");
    return result;
  }

  for (const o of eligible) {
    try {
      // Respect opt-out — never chase an employer who unsubscribed.
      if (o.match.employer?.optedOut) { result.skipped++; continue; }

      const candidateName = o.match.candidate.name;
      const employerName = o.match.employer?.name ?? "";
      const position = o.match.vacancy?.title || o.match.vacancy?.beruf || "die ausgeschriebene Stelle";
      const subject = o.subject
        ? (o.subject.startsWith("Erinnerung") ? o.subject : `Erinnerung: ${o.subject}`)
        : `Erinnerung: Bewerbung ${candidateName}`;

      // Attach the candidate's CV to the reminder too (same as the first mail):
      // uploaded original if present, otherwise a generated Lebenslauf PDF.
      const cand = o.match.candidate;
      let attachments: { filename: string; content: Buffer }[] = [];
      if (cand.cvData) {
        attachments = [{ filename: cand.cvFileName || cvFileName(candidateName), content: Buffer.from(cand.cvData) }];
      } else {
        try {
          const full = await prisma.candidate.findUnique({ where: { id: cand.id } });
          if (full) {
            const pdf = await Promise.race([
              generateCandidateCvPdf(full),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("PDF timeout")), 25000)),
            ]);
            attachments = [{ filename: cvFileName(candidateName), content: pdf }];
          }
        } catch { /* non-fatal — send the reminder without attachment */ }
      }

      const sendResult = await sendMail({
        to: o.toAddress!,
        subject,
        text: followUpBody(candidateName, employerName, position, o.sentAt!) + complianceFooter(o.match.employerId),
        attachments,
      });

      await prisma.outreach.update({
        where: { id: o.id },
        data: {
          followUpCount: { increment: 1 },
          lastFollowUpAt: new Date(),
          // keep providerId pointing at the latest message for webhook tracking
          providerId: sendResult.id ?? undefined,
        },
      });
      result.sent++;
    } catch (err) {
      result.errors.push(`${o.toAddress}: ${(err as Error).message}`);
    }
  }

  return result;
}
