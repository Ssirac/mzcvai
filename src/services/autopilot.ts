/**
 * Auto-pilot sending — whenever new matching jobs exist for a candidate, the
 * application email goes out automatically (no clicking). Runs after every
 * matching pass (4-hourly refresh + nightly), covering existing candidates'
 * backlogs too.
 *
 * Safety rails (all enforced in the send path, not just here):
 *  - only candidates WITH an uploaded CV (AUTO_SEND_REQUIRE_CV=false to relax)
 *  - per-candidate daily cap (MAX_OUTREACH_PER_DAY, default 20)
 *  - GLOBAL daily cap across all candidates (GLOBAL_DAILY_CAP, default 60) —
 *    protects the sending domain from spam-flagging
 *  - per-candidate-per-employer cooldown, opted-out skip, generic-email-only,
 *    executive-address block, bounced-address block
 *
 * Disable entirely with AUTO_SEND_ENABLED=false.
 */

import { prisma } from "@/lib/prisma";
import { sendAllForCandidate } from "@/services/outreach";
import { runEmployerOutreachCycle, runEmployerOutreachForCandidate } from "@/services/employerOutreach";

// Feature 3 supersession: when the governed employer-outreach flow is enabled
// (AUTO_EMAIL_ENABLED=true), ALL auto-send goes through it (consent, dedupe,
// per-employer cap, review band, dry-run) instead of the legacy ungoverned
// send — so the two never both fire and no employer is emailed twice.
const governed = () => process.env.AUTO_EMAIL_ENABLED === "true";

export interface AutoPilotResult {
  candidates: number;
  sent: number;
  skipped: number;
  errors: string[];
  disabled?: boolean;
  capReached?: boolean;
}

// Auto-send for ONE candidate — used the moment new matching jobs are found for
// them (on match view / re-match), so the application goes out immediately
// instead of waiting for the next cron pass. Enforces the same gates as the
// batch run: kill switch, ACTIVE status, and the CV requirement. All the hard
// safety rails (caps, cooldown, opt-out, generic-email-only) live in the send
// path itself.
export async function autoSendForCandidate(candidateId: string): Promise<void> {
  // Governed path takes over entirely when enabled.
  if (governed()) { await runEmployerOutreachForCandidate(candidateId); return; }
  if (process.env.AUTO_SEND_ENABLED === "false") return;
  const requireCv = process.env.AUTO_SEND_REQUIRE_CV !== "false";
  const c = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { status: true, cvData: true },
  });
  if (!c || c.status !== "ACTIVE") return;
  if (requireCv && !c.cvData) return;
  await sendAllForCandidate(candidateId, "auto-pilot");
}

export async function runAutoSend(): Promise<AutoPilotResult> {
  const result: AutoPilotResult = { candidates: 0, sent: 0, skipped: 0, errors: [] };

  // Governed path takes over entirely when enabled — map its summary onto the
  // AutoPilotResult the callers already log.
  if (governed()) {
    const c = await runEmployerOutreachCycle();
    result.sent = c.sent;
    result.skipped = c.skippedDedupe + c.skippedConsent + c.skippedCap + c.skippedIncomplete + c.held + c.dryRun;
    return result;
  }

  if (process.env.AUTO_SEND_ENABLED === "false") {
    result.disabled = true;
    return result;
  }

  const requireCv = process.env.AUTO_SEND_REQUIRE_CV !== "false";

  // Candidates eligible for auto-pilot: active, and (by default) with a real
  // uploaded CV — the user's rule: sending starts once the CV is attached.
  const candidates = await prisma.candidate.findMany({
    where: {
      status: "ACTIVE",
      ...(requireCv ? { cvData: { not: null } } : {}),
    },
    select: { id: true, name: true },
  });

  for (const c of candidates) {
    try {
      const r = await sendAllForCandidate(c.id, "auto-pilot");
      result.candidates++;
      result.sent += r.sent;
      result.skipped += r.skippedNoEmail + r.skippedCooldown + r.skippedOptedOut + r.alreadySent;
      if (r.errors.length) {
        result.errors.push(...r.errors.slice(0, 3).map((e) => `${c.name}: ${e}`));
      }
      // Global cap hit — no point trying further candidates this run.
      if (r.limitReached && r.errors.some((e) => e.includes("global"))) {
        result.capReached = true;
        break;
      }
    } catch (err) {
      result.errors.push(`${c.name}: ${(err as Error).message}`);
    }
  }

  return result;
}
