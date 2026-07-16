/**
 * Governed auto-outreach to employers (Feature 3).
 *
 * When a candidate matches a job/employer strongly enough, the candidate's
 * application (named — MZ Personalvermittlung on their behalf, NOT anonymised) is
 * emailed to that employer automatically. Every send passes a fixed set of gates
 * and is recorded in EmployerOutreachLog, which also enforces idempotency via its
 * unique (candidate, employer, job).
 *
 * GATES (all must pass, in order):
 *   1. AUTO_EMAIL_ENABLED             — global kill switch (default OFF)
 *   2. dedupe                         — (candidate,employer,job) already resolved → SKIPPED_DEDUPE
 *   3. employer.outreachConsent       — no consent → never send
 *   4. candidate.profileComplete      — half-finished profile → never send
 *   5. daily cap                      — employer's sends today ≥ cap → SKIPPED_DAILY_LIMIT
 *   6. review band                    — MATCH_THRESHOLD..REVIEW_THRESHOLD → HELD_FOR_REVIEW
 *   7. AUTO_EMAIL_DRY_RUN             — log DRY_RUN, don't send
 *   → otherwise SEND (retry ≤3), log SENT / FAILED.
 *
 * Every employer mail carries a mandatory unsubscribe link (GDPR) + MZ contact.
 * Scores are on the existing 0–100 fitScore scale (MATCH=85, REVIEW=92).
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { composeApplicationLetter, AGENCY_NAME } from "@/services/outreach";
import { generateCandidateCvPdf, cvFileName } from "@/services/cvPdf";

const TEMPLATE = "employer-auto-de";

export function outreachConfig() {
  return {
    enabled: process.env.AUTO_EMAIL_ENABLED === "true",
    dryRun: process.env.AUTO_EMAIL_DRY_RUN !== "false", // default true (safe)
    matchThreshold: parseFloat(process.env.MATCH_THRESHOLD ?? "85"),
    reviewThreshold: parseFloat(process.env.REVIEW_THRESHOLD ?? "92"),
    requireReview: process.env.REQUIRE_REVIEW_ABOVE_STAKES !== "false", // default true
    defaultCap: parseInt(process.env.DEFAULT_DAILY_OUTREACH_CAP ?? "5"),
  };
}

// A candidate is "complete enough to present" when the essentials an employer
// needs are all present. Mirrors the profile-completeness bar used in the UI.
export function evaluateProfileComplete(c: {
  email: string | null; phone: string | null; beruf: string | null;
  languages: string[]; germanLevel: string | null;
  cvData: unknown | null; experience: unknown;
}): boolean {
  const hasCv = !!c.cvData || (Array.isArray(c.experience) && c.experience.length > 0);
  return !!(
    c.email && c.phone && c.beruf &&
    (c.languages?.length ?? 0) > 0 &&
    c.germanLevel && hasCv
  );
}

export type OutreachStatus =
  | "SENT" | "FAILED" | "SKIPPED_DEDUPE" | "SKIPPED_DAILY_LIMIT"
  | "DRY_RUN" | "HELD_FOR_REVIEW"
  // non-logged early exits:
  | "DISABLED" | "SKIPPED_NO_CONSENT" | "SKIPPED_INCOMPLETE" | "SKIPPED_BELOW_THRESHOLD" | "SKIPPED_NO_EMAIL";

export interface AttemptParams {
  candidateId: string;
  employerId: string;
  jobId: string; // vacancy id
  matchScore: number; // 0–100
}

// Persist a terminal decision on the unique (candidate,employer,job) triple.
async function logOutreach(p: AttemptParams, status: OutreachStatus, error?: string) {
  await prisma.employerOutreachLog.upsert({
    where: { candidateId_employerId_jobId: { candidateId: p.candidateId, employerId: p.employerId, jobId: p.jobId } },
    create: { candidateId: p.candidateId, employerId: p.employerId, jobId: p.jobId, template: TEMPLATE, status, error, sentAt: new Date() },
    update: { status, error, sentAt: new Date() },
  });
}

/**
 * Run all gates for one (candidate, employer, job) and act. Returns the decision.
 * Safe to call repeatedly — idempotent on the unique triple.
 */
export async function attemptEmployerOutreach(p: AttemptParams): Promise<{ status: OutreachStatus; error?: string }> {
  const cfg = outreachConfig();

  // Gate 1 — global kill switch. No log row (nothing was decided per-item).
  if (!cfg.enabled) return { status: "DISABLED" };

  // Gate 0 — score must clear the floor (caller usually pre-filters, belt & braces).
  if (p.matchScore < cfg.matchThreshold) return { status: "SKIPPED_BELOW_THRESHOLD" };

  // Gate 2 — dedupe. A row already resolved as sent/dry-run/held → never repeat.
  const existing = await prisma.employerOutreachLog.findUnique({
    where: { candidateId_employerId_jobId: { candidateId: p.candidateId, employerId: p.employerId, jobId: p.jobId } },
    select: { status: true },
  });
  if (existing && ["SENT", "DRY_RUN", "HELD_FOR_REVIEW"].includes(existing.status)) {
    return { status: "SKIPPED_DEDUPE" };
  }

  const [candidate, employer, vacancy] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: p.candidateId } }),
    prisma.employer.findUnique({ where: { id: p.employerId } }),
    prisma.vacancy.findUnique({ where: { id: p.jobId } }),
  ]);
  if (!candidate || !employer || !vacancy) return { status: "FAILED", error: "candidate/employer/job not found" };

  // Gate 3 — employer consent. Never email a non-consenting employer.
  if (!employer.outreachConsent || employer.optedOut) return { status: "SKIPPED_NO_CONSENT" };

  // Gate 4 — candidate profile completeness (trust stored flag, else compute).
  const complete = candidate.profileComplete || evaluateProfileComplete(candidate);
  if (!complete) return { status: "SKIPPED_INCOMPLETE" };

  if (!employer.genericEmail) return { status: "SKIPPED_NO_EMAIL" };

  // Gate 5 — per-employer daily cap (count real sends today).
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const sentToday = await prisma.employerOutreachLog.count({
    where: { employerId: p.employerId, status: "SENT", sentAt: { gte: dayStart } },
  });
  const cap = employer.dailyOutreachCap ?? cfg.defaultCap;
  if (sentToday >= cap) { await logOutreach(p, "SKIPPED_DAILY_LIMIT"); return { status: "SKIPPED_DAILY_LIMIT" }; }

  // Gate 6 — review band: strong-but-not-certain → hold for one-click admin review.
  if (cfg.requireReview && p.matchScore >= cfg.matchThreshold && p.matchScore < cfg.reviewThreshold) {
    await logOutreach(p, "HELD_FOR_REVIEW");
    return { status: "HELD_FOR_REVIEW" };
  }

  // Gate 7 — dry run: decide-and-log, never send.
  if (cfg.dryRun) { await logOutreach(p, "DRY_RUN"); return { status: "DRY_RUN" }; }

  // SEND (retry ≤3).
  try {
    await sendEmployerMail(candidate, employer, vacancy);
    await logOutreach(p, "SENT");
    return { status: "SENT" };
  } catch (err) {
    const msg = (err as Error).message;
    await logOutreach(p, "FAILED", msg);
    return { status: "FAILED", error: msg };
  }
}

// Compose + send the named application to the employer, with CV attachment,
// mandatory unsubscribe (GDPR) and MZ contact. Retries transient failures ≤3.
async function sendEmployerMail(
  candidate: NonNullable<Awaited<ReturnType<typeof prisma.candidate.findUnique>>>,
  employer: NonNullable<Awaited<ReturnType<typeof prisma.employer.findUnique>>>,
  vacancy: NonNullable<Awaited<ReturnType<typeof prisma.vacancy.findUnique>>>
) {
  const { subject, body } = await composeApplicationLetter(candidate, employer, vacancy);
  const footer = unsubscribeFooter(employer.id);

  // CV attachment: uploaded original, else generated.
  let attachments: { filename: string; content: Buffer }[] = [];
  if (candidate.cvData) {
    attachments = [{ filename: candidate.cvFileName || cvFileName(candidate.name), content: Buffer.from(candidate.cvData) }];
  } else {
    try {
      const pdf = await Promise.race([
        generateCandidateCvPdf(candidate),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("PDF timeout")), 25000)),
      ]);
      attachments = [{ filename: cvFileName(candidate.name), content: pdf }];
    } catch { /* send without attachment */ }
  }

  const recipient = process.env.OUTREACH_TEST_RECIPIENT?.trim() || employer.genericEmail!;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sendMail({ to: recipient, subject, text: body + footer, attachments });
      return;
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr ?? new Error("send failed");
}

export interface OutreachCycleResult {
  attempted: number; sent: number; held: number; dryRun: number;
  skippedDedupe: number; skippedConsent: number; skippedCap: number;
  skippedIncomplete: number; failed: number;
}

function emptyCycle(): OutreachCycleResult {
  return { attempted: 0, sent: 0, held: 0, dryRun: 0, skippedDedupe: 0, skippedConsent: 0, skippedCap: 0, skippedIncomplete: 0, failed: 0 };
}

function tally(r: OutreachCycleResult, status: OutreachStatus) {
  r.attempted++;
  if (status === "SENT") r.sent++;
  else if (status === "HELD_FOR_REVIEW") r.held++;
  else if (status === "DRY_RUN") r.dryRun++;
  else if (status === "SKIPPED_DEDUPE") r.skippedDedupe++;
  else if (status === "SKIPPED_NO_CONSENT") r.skippedConsent++;
  else if (status === "SKIPPED_DAILY_LIMIT") r.skippedCap++;
  else if (status === "SKIPPED_INCOMPLETE") r.skippedIncomplete++;
  else if (status === "FAILED") r.failed++;
}

// Qualifying matches for a set of candidates: fitScore ≥ MATCH_THRESHOLD, newest
// strongest first. attemptEmployerOutreach re-checks every gate per item.
async function processMatches(candidateIds: string[] | null): Promise<OutreachCycleResult> {
  const cfg = outreachConfig();
  const result = emptyCycle();
  if (!cfg.enabled) return result;

  const sendDelayMs = parseInt(process.env.OUTREACH_SEND_DELAY_MS ?? "3000");
  const matches = await prisma.match.findMany({
    where: {
      fitScore: { gte: Math.ceil(cfg.matchThreshold) },
      feedback: { not: "BAD" }, // recruiter-rejected matches are never auto-sent
      ...(candidateIds ? { candidateId: { in: candidateIds } } : { candidate: { status: { in: ["ACTIVE", "PENDING"] } } }),
    },
    orderBy: [{ employer: { score: "desc" } }, { fitScore: "desc" }],
    select: { candidateId: true, employerId: true, vacancyId: true, fitScore: true },
    take: 2000,
  });

  for (const m of matches) {
    const { status } = await attemptEmployerOutreach({
      candidateId: m.candidateId, employerId: m.employerId, jobId: m.vacancyId, matchScore: m.fitScore,
    });
    tally(result, status);
    // Only pace real sends — skips/holds are cheap and shouldn't slow the run.
    if (status === "SENT" && sendDelayMs > 0) await new Promise((r) => setTimeout(r, sendDelayMs));
  }
  return result;
}

// Full governed cycle across all active/pending candidates.
export function runEmployerOutreachCycle(): Promise<OutreachCycleResult> {
  return processMatches(null);
}

// Governed outreach for one candidate (used the moment new matches appear).
export function runEmployerOutreachForCandidate(candidateId: string): Promise<OutreachCycleResult> {
  return processMatches([candidateId]);
}

/**
 * Admin approves a HELD_FOR_REVIEW item → send it now. Bypasses the review band,
 * dry-run and the dedupe hold (it IS the held row), but STILL honours consent —
 * a non-consenting employer is never emailed even on manual approval.
 */
export async function approveHeldOutreach(logId: string): Promise<{ status: OutreachStatus; error?: string }> {
  const log = await prisma.employerOutreachLog.findUnique({ where: { id: logId } });
  if (!log) return { status: "FAILED", error: "not found" };
  if (log.status !== "HELD_FOR_REVIEW") return { status: "SKIPPED_DEDUPE" };

  const [candidate, employer, vacancy] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: log.candidateId } }),
    prisma.employer.findUnique({ where: { id: log.employerId } }),
    prisma.vacancy.findUnique({ where: { id: log.jobId } }),
  ]);
  if (!candidate || !employer || !vacancy) return { status: "FAILED", error: "candidate/employer/job not found" };
  if (!employer.outreachConsent || employer.optedOut) return { status: "SKIPPED_NO_CONSENT" };
  if (!employer.genericEmail) return { status: "SKIPPED_NO_EMAIL" };

  const p: AttemptParams = { candidateId: log.candidateId, employerId: log.employerId, jobId: log.jobId, matchScore: 100 };
  try {
    await sendEmployerMail(candidate, employer, vacancy);
    await logOutreach(p, "SENT");
    return { status: "SENT" };
  } catch (err) {
    const msg = (err as Error).message;
    await logOutreach(p, "FAILED", msg);
    return { status: "FAILED", error: msg };
  }
}

// Mandatory GDPR unsubscribe line + MZ contact (Feature 3 uses an MZ contact link,
// not an anonymised portal).
function unsubscribeFooter(employerId: string): string {
  const base = process.env.PUBLIC_APP_URL || "https://mzcvai-production.up.railway.app";
  const contact = process.env.AGENCY_CONTACT_EMAIL || process.env.SMTP_USER || "info@mz-personalvermittlung.de";
  return [
    "",
    "",
    "—",
    `Rückfragen: ${AGENCY_NAME}, ${contact}`,
    `Wenn Sie keine weiteren Kandidatenvorschläge wünschen, hier abmelden: ${base}/api/unsubscribe?id=${employerId}`,
  ].join("\n");
}
