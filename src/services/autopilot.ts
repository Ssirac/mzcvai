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

export interface AutoPilotResult {
  candidates: number;
  sent: number;
  skipped: number;
  errors: string[];
  disabled?: boolean;
  capReached?: boolean;
}

export async function runAutoSend(): Promise<AutoPilotResult> {
  const result: AutoPilotResult = { candidates: 0, sent: 0, skipped: 0, errors: [] };

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
