import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";

// GET /api/candidates/[id] — full candidate record (for editing)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: params.id },
      omit: { cvData: true },
    });
    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ candidate: { ...candidate, hasCv: !!candidate.cvFileName } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/candidates/[id] — quick status change (PENDING | PLACED | ARCHIVED)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;
    const body = await req.json();
    const status = body.status;
    if (!["ACTIVE", "PENDING", "PLACED", "ARCHIVED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const candidate = await prisma.candidate.update({
      where: { id: params.id },
      data: { status },
    });
    await logAudit({ actor: authz.actor, action: "CANDIDATE_UPDATE", targetType: "candidate", targetId: params.id, meta: { status } });
    return NextResponse.json({ ok: true, candidate });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/candidates/[id] — GDPR-complete erasure: the candidate (incl. CV
// bytes) and EVERY record that references them, including the ones with no FK
// cascade (JobApplicationLog, CaptchaQueue, EmployerOutreachLog).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authz = await authorize(req, "candidate.delete");
    if (!authz.ok) return authz.response;
    const actor = authz.actor;
    const id = params.id;
    const matchIds = (
      await prisma.match.findMany({ where: { candidateId: id }, select: { id: true } })
    ).map((m) => m.id);

    await prisma.outreach.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { candidateId: id } });
    // Non-FK personal-data tables keyed by candidateId (string):
    await prisma.jobApplicationLog.deleteMany({ where: { candidateId: id } });
    await prisma.captchaQueue.deleteMany({ where: { candidateId: id } });
    await prisma.employerOutreachLog.deleteMany({ where: { candidateId: id } });
    await prisma.candidate.delete({ where: { id } });

    await logAudit({ actor, action: "GDPR_DELETE", targetType: "candidate", targetId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
