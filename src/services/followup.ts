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
 *   FOLLOWUP_INTERVALS    staged gaps (days) between touches, e.g. "3,7,14":
 *                         1st reminder 3 days after send, 2nd 7 days after the
 *                         1st, 3rd 14 days after the 2nd. The number of entries
 *                         is the cap. Widening gaps reads far less pushy than a
 *                         fixed cadence. Overrides FOLLOWUP_DAYS/FOLLOWUP_MAX.
 *   FOLLOWUP_DAYS         (fallback) fixed days between each touch (default 3)
 *   FOLLOWUP_MAX          (fallback) max follow-ups per application (default 2)
 *   FOLLOWUP_BATCH        max follow-ups sent per run (default 40)
 *   FOLLOWUPS_ENABLED     must be "true" to actually send (safety switch)
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { agencySignature, complianceFooter } from "@/services/outreach";
import { generateCandidateCvPdf, cvFileName } from "@/services/cvPdf";

const DAY = 24 * 60 * 60 * 1000;

export interface FollowUpResult {
  eligible: number;
  sent: number;
  skipped: number;
  errors: string[];
}

// Staged gaps (in days) between consecutive touches. Prefers FOLLOWUP_INTERVALS
// ("3,7,14"); falls back to FOLLOWUP_MAX touches each FOLLOWUP_DAYS apart so the
// old behaviour is unchanged when the new var is unset.
function followUpIntervals(): number[] {
  const raw = process.env.FOLLOWUP_INTERVALS;
  if (raw) {
    const arr = raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    if (arr.length) return arr;
  }
  const days = Math.max(1, parseInt(process.env.FOLLOWUP_DAYS || "3", 10));
  const max = Math.max(1, parseInt(process.env.FOLLOWUP_MAX || "2", 10));
  return Array(max).fill(days);
}

// Message copy per stage. The final touch is softer and offers an easy "no" —
// this both lifts reply rate and keeps us on the right side of UWG/reputation.
function followUpBody(
  candidateName: string,
  employerName: string,
  position: string,
  sentAt: Date,
  isFinal: boolean,
): string {
  const bei = employerName ? ` bei ${employerName}` : "";
  if (isFinal) {
    return [
      "Sehr geehrte Damen und Herren,",
      "",
      `ich hatte mich bereits wegen der Bewerbung von ${candidateName} als ${position}${bei} gemeldet.`,
      "",
      "Sollte die Position bereits besetzt sein oder aktuell kein Bedarf bestehen, ist das selbstverständlich völlig in Ordnung — eine kurze Rückmeldung genügt, und ich sehe von weiteren Nachrichten ab. Andernfalls stehe ich für ein kurzes, unverbindliches Online-Gespräch jederzeit gern zur Verfügung.",
      "",
      agencySignature(candidateName),
    ].join("\n");
  }
  const dateStr = sentAt.toLocaleDateString("de-DE");
  return [
    "Sehr geehrte Damen und Herren,",
    "",
    `ich komme höflich auf meine Bewerbung vom ${dateStr} für ${candidateName} als ${position}${bei} zurück.`,
    "",
    "Über eine kurze Rückmeldung, ob die Unterlagen angekommen sind und ob grundsätzliches Interesse besteht, würde ich mich sehr freuen. Selbstverständlich stehe ich für Rückfragen oder ein kurzes, unverbindliches Online-Vorstellungsgespräch jederzeit gern zur Verfügung.",
    "",
    agencySignature(candidateName),
  ].join("\n");
}

export async function runFollowUps(): Promise<FollowUpResult> {
  const result: FollowUpResult = { eligible: 0, sent: 0, skipped: 0, errors: [] };

  const intervals = followUpIntervals();
  const maxFollowUps = intervals.length;
  const minIntervalDays = Math.min(...intervals);
  const batch = parseInt(process.env.FOLLOWUP_BATCH || "40");
  const enabled = process.env.FOLLOWUPS_ENABLED === "true";

  const now = Date.now();
  // Coarse pre-filter: nothing can be due before the SHORTEST configured gap has
  // passed since the send. The precise per-stage gap is checked in code below.
  const coarseCutoff = new Date(now - minIntervalDays * DAY);

  const candidates = await prisma.outreach.findMany({
    where: {
      status: { in: ["SENT", "OPENED"] },
      toAddress: { not: null },
      followUpCount: { lt: maxFollowUps },
      sentAt: { not: null, lte: coarseCutoff },
    },
    select: {
      id: true, toAddress: true, subject: true, sentAt: true, followUpCount: true, lastFollowUpAt: true,
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
    take: Math.max(batch * 3, 60),
  });

  // Precise per-stage gate: the gap since the LAST touch (sentAt for the first
  // reminder, else lastFollowUpAt) must have reached this stage's interval.
  const eligible = candidates
    .filter((o) => {
      const requiredDays = intervals[o.followUpCount] ?? intervals[intervals.length - 1];
      const lastTouch = (o.lastFollowUpAt ?? o.sentAt!).getTime();
      return now - lastTouch >= requiredDays * DAY;
    })
    .slice(0, batch);

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
      // This send is touch #(followUpCount + 1); it's the final one when it
      // reaches the configured cap.
      const isFinal = o.followUpCount >= maxFollowUps - 1;
      const baseSubject = o.subject?.replace(/^(Erinnerung|\d+\.\s*Erinnerung):\s*/i, "") ?? `Bewerbung ${candidateName}`;
      const subject = `Erinnerung: ${baseSubject}`;

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
        text: followUpBody(candidateName, employerName, position, o.sentAt!, isFinal) + complianceFooter(o.match.employerId),
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
