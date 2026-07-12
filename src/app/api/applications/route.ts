import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/applications — the external-application audit log (JobApplicationLog),
// candidate name resolved, newest first.
export async function GET() {
  try {
    const rows = await prisma.jobApplicationLog.findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const candIds = Array.from(new Set(rows.map((r) => r.candidateId)));
    const cands = await prisma.candidate.findMany({ where: { id: { in: candIds } }, select: { id: true, name: true } });
    const nameOf = new Map(cands.map((c) => [c.id, c.name]));

    const items = rows.map((r) => ({
      id: r.id,
      candidateName: nameOf.get(r.candidateId) ?? "—",
      company: r.company,
      position: r.position,
      link: r.link,
      source: r.source,
      status: r.status,
      updatedAt: r.updatedAt,
    }));

    const counts = rows.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
    return NextResponse.json({ items, total: items.length, counts });
  } catch (err) {
    return apiError(err);
  }
}
