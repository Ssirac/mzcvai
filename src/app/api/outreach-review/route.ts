import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { approveHeldOutreach } from "@/services/employerOutreach";

export const dynamic = "force-dynamic";

// GET /api/outreach-review — items held for human review (score in the
// MATCH..REVIEW band), with candidate/employer/job resolved for display.
export async function GET() {
  try {
    const rows = await prisma.employerOutreachLog.findMany({
      where: { status: "HELD_FOR_REVIEW" },
      orderBy: { sentAt: "desc" },
      take: 300,
    });

    const candIds = Array.from(new Set(rows.map((r) => r.candidateId)));
    const empIds = Array.from(new Set(rows.map((r) => r.employerId)));
    const jobIds = Array.from(new Set(rows.map((r) => r.jobId)));
    const [cands, emps, jobs] = await Promise.all([
      prisma.candidate.findMany({ where: { id: { in: candIds } }, select: { id: true, name: true, beruf: true } }),
      prisma.employer.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true, city: true, genericEmail: true, outreachConsent: true } }),
      prisma.vacancy.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true } }),
    ]);
    const cMap = new Map(cands.map((c) => [c.id, c]));
    const eMap = new Map(emps.map((e) => [e.id, e]));
    const jMap = new Map(jobs.map((j) => [j.id, j]));

    const items = rows.map((r) => ({
      id: r.id,
      candidate: cMap.get(r.candidateId) ?? null,
      employer: eMap.get(r.employerId) ?? null,
      job: jMap.get(r.jobId) ?? null,
      createdAt: r.sentAt,
    }));
    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    return apiError(err);
  }
}

// POST /api/outreach-review — batch act on held items.
// Body: { ids: string[], action: "send" | "dismiss" }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
    const action: string = body.action;
    if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

    const summary = { sent: 0, dismissed: 0, failed: 0 };
    const results: { id: string; ok: boolean; status?: string; error?: string }[] = [];

    for (const id of ids) {
      if (action === "send") {
        const r = await approveHeldOutreach(id);
        if (r.status === "SENT") summary.sent++;
        else summary.failed++;
        results.push({ id, ok: r.status === "SENT", status: r.status, error: r.error });
      } else if (action === "dismiss") {
        // Dismiss: mark resolved so it won't send or re-appear.
        await prisma.employerOutreachLog.update({ where: { id }, data: { status: "SKIPPED_DEDUPE" } });
        summary.dismissed++;
        results.push({ id, ok: true, status: "SKIPPED_DEDUPE" });
      } else {
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true, ...summary, results });
  } catch (err) {
    return apiError(err);
  }
}
