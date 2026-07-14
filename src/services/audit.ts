/**
 * Append-only audit logging. Best-effort: a failure to write an audit row must
 * never break the user action, so every write is wrapped and swallowed.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "LOGIN"
  | "CANDIDATE_CREATE" | "CANDIDATE_UPDATE" | "CANDIDATE_DELETE"
  | "CV_UPLOAD" | "CV_DOWNLOAD"
  | "OUTREACH_APPROVE" | "OUTREACH_SEND"
  | "OPT_OUT"
  | "DEAD_SWEEP"
  | "GDPR_EXPORT" | "GDPR_DELETE";

export async function logAudit(p: {
  actor: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor: p.actor ?? "system",
        action: p.action,
        targetType: p.targetType ?? null,
        targetId: p.targetId ?? null,
        meta: (p.meta ?? undefined) as Prisma.InputJsonValue,
      },
    });
  } catch {
    /* audit must never block the action */
  }
}
