import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { createOutreachDraft } from "@/services/outreach";

export const maxDuration = 300;

/**
 * POST /api/outreach/prepare — build DRAFT outreach for review WITHOUT sending.
 *
 * This is the human-in-the-loop entry point: it prepares the proposals
 * ("this candidate → this job → this email") that the admin then reviews and
 * approves in the Review panel. It never approves or sends.
 *
 * Body: { candidateId?, matchIds?, limit? }
 *   • matchIds  — prepare exactly these matches
 *   • candidateId — prepare the candidate's top matches
 *   • neither    — prepare across ALL active candidates' top matches
 *
 * Only matches whose employer already exposes a generic email and isn't opted
 * out are prepared (fast, no on-demand scraping); matches that already have any
 * outreach are skipped so we never duplicate a proposal.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const candidateId: string | undefined = typeof body.candidateId === "string" ? body.candidateId : undefined;
    const matchIds: string[] | undefined = Array.isArray(body.matchIds)
      ? body.matchIds.filter((x: unknown): x is string => typeof x === "string")
      : undefined;
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? 25), 10) || 25, 1), 100);

    const matches = await prisma.match.findMany({
      where: {
        ...(matchIds && matchIds.length ? { id: { in: matchIds } } : {}),
        ...(candidateId ? { candidateId } : {}),
        ...(matchIds ? {} : { candidate: { status: { in: ["ACTIVE", "PENDING"] } } }),
      },
      orderBy: [{ employer: { score: "desc" } }, { fitScore: "desc" }],
      take: matchIds && matchIds.length ? matchIds.length : limit,
      include: { employer: { select: { genericEmail: true, optedOut: true } }, outreach: { select: { id: true } } },
    });

    const result = { prepared: 0, skippedNoEmail: 0, skippedOptedOut: 0, skippedExisting: 0, failed: 0, errors: [] as string[] };
    const preparedIds: string[] = [];

    for (const m of matches) {
      if (m.outreach.length > 0) { result.skippedExisting++; continue; }
      if (m.employer.optedOut) { result.skippedOptedOut++; continue; }
      if (!m.employer.genericEmail) { result.skippedNoEmail++; continue; }
      try {
        const id = await createOutreachDraft(m.id);
        preparedIds.push(id);
        result.prepared++;
      } catch (err) {
        result.failed++;
        result.errors.push((err as Error).message);
      }
    }

    return NextResponse.json({ ok: true, ...result, outreachIds: preparedIds });
  } catch (err) {
    return apiError(err);
  }
}
