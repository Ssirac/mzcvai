import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { familyCompatibility } from "@/lib/occupationFamily";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/captcha-queue/cleanup — remove PENDING/IN_PROGRESS robot-queue items
// that are cross-profession (the candidate's occupation and the job's title are
// in different families). These are stale entries created before the
// occupation-family gate existed. Dry-run by default; { apply:true } deletes.
export async function POST(req: NextRequest) {
  try {
    let apply = false;
    try { apply = !!(await req.json())?.apply; } catch { /* dry-run */ }

    const items = await prisma.captchaQueue.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, candidateId: true, jobId: true },
    });
    if (items.length === 0) return NextResponse.json({ ok: true, scanned: 0, incompatible: 0, removed: 0, examples: [] });

    const candIds = Array.from(new Set(items.map((i) => i.candidateId)));
    const jobIds = Array.from(new Set(items.map((i) => i.jobId)));
    const [cands, jobs] = await Promise.all([
      prisma.candidate.findMany({ where: { id: { in: candIds } }, select: { id: true, name: true, desiredPosition: true, beruf: true } }),
      prisma.vacancy.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true, beruf: true } }),
    ]);
    const candMap = new Map(cands.map((c) => [c.id, c]));
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    const toRemove: string[] = [];
    const examples: { candidate: string; job: string }[] = [];
    for (const it of items) {
      const c = candMap.get(it.candidateId);
      const j = jobMap.get(it.jobId);
      if (!c || !j) continue;
      const profile = c.desiredPosition?.trim() || c.beruf || "";
      const fam = familyCompatibility(profile, j.title, j.beruf);
      if (fam.decided && !fam.compatible) {
        toRemove.push(it.id);
        if (examples.length < 15) examples.push({ candidate: c.name, job: j.title });
      }
    }

    let removed = 0;
    if (apply && toRemove.length) {
      const r = await prisma.captchaQueue.deleteMany({ where: { id: { in: toRemove } } });
      removed = r.count;
      const actor = await getSessionUser(req);
      await logAudit({ actor, action: "DEAD_SWEEP", targetType: "captcha-queue", targetId: `removed:${removed}`, meta: { removed } });
    }

    return NextResponse.json({ ok: true, scanned: items.length, incompatible: toRemove.length, removed, examples });
  } catch (err) {
    return apiError(err);
  }
}
