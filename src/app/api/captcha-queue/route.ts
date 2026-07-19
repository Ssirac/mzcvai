import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { occupationClusters } from "@/lib/occupationFamily";

export const dynamic = "force-dynamic";

// GET /api/captcha-queue?status=PENDING (default: PENDING + IN_PROGRESS)
// Returns the queue grouped by candidate, so the admin sees e.g.
// "Vəli — 4 matching jobs awaiting robot confirmation".
export async function GET(req: NextRequest) {
  try {
    const VALID_STATUSES = ["PENDING", "IN_PROGRESS", "SUBMITTED", "SKIPPED", "FAILED"];
    const statusParam = new URL(req.url).searchParams.get("status");
    // Unknown status values fall back to the default view instead of a Prisma 500.
    const where = statusParam && VALID_STATUSES.includes(statusParam)
      ? { status: statusParam }
      : { status: { in: ["PENDING", "IN_PROGRESS"] } };

    const allRows = await prisma.captchaQueue.findMany({
      where,
      orderBy: [{ matchScore: "desc" }, { createdAt: "asc" }],
      take: 500,
    });

    // Resolve candidate names (CaptchaQueue stores candidateId as a plain string).
    const candIds = Array.from(new Set(allRows.map((r) => r.candidateId)));
    const cands = await prisma.candidate.findMany({
      where: { id: { in: candIds } },
      select: { id: true, name: true, beruf: true, desiredPosition: true },
    });
    const nameOf = new Map(cands.map((c) => [c.id, c]));

    // Occupation re-check against the CURRENT gate: old queue rows were enqueued
    // under looser matching, so a hotel candidate could still show a technical
    // "Servicetechniker" job here. Apply the SAME core-cluster cross-field gate
    // the matcher uses — the candidate's CORE field (desired position + beruf)
    // must share a cluster with the vacancy title. Clears stale mismatches
    // immediately, without waiting for a re-match. Unclassifiable core/title →
    // keep (can't judge, low risk).
    const coreClustersOf = new Map(
      cands.map((c) => {
        const set = new Set<string>();
        for (const core of [c.desiredPosition, c.beruf]) {
          if (core && core.trim()) for (const cl of occupationClusters(core)) set.add(cl);
        }
        return [c.id, set] as const;
      })
    );
    const rows = allRows.filter((r) => {
      const core = coreClustersOf.get(r.candidateId);
      if (!core || core.size === 0) return true;
      const vac = occupationClusters(r.jobTitle);
      if (vac.size === 0) return true;
      return Array.from(vac).some((cl) => core.has(cl));
    });

    const groupMap = new Map<string, { candidateId: string; candidateName: string; beruf: string; items: typeof rows }>();
    for (const r of rows) {
      const c = nameOf.get(r.candidateId);
      const g = groupMap.get(r.candidateId) ?? {
        candidateId: r.candidateId,
        candidateName: c?.name ?? "—",
        beruf: c?.beruf ?? "",
        items: [] as typeof rows,
      };
      g.items.push(r);
      groupMap.set(r.candidateId, g);
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => b.items.length - a.items.length);
    return NextResponse.json({ groups, total: rows.length });
  } catch (err) {
    return apiError(err);
  }
}
