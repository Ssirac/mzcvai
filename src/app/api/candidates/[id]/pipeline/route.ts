import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import type { PipelineStage } from "@prisma/client";

export const dynamic = "force-dynamic";

const STAGES: PipelineStage[] = [
  "NEW", "PROFILE_READY", "MATCHED", "PRESENTED", "INTERVIEW", "VISA", "PLACED", "REJECTED", "ARCHIVED",
];

// GET /api/candidates/[id]/pipeline — current stage + transition history.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.read");
    if (!authz.ok) return authz.response;
    const candidate = await prisma.candidate.findUnique({
      where: { id: params.id },
      select: { pipelineStage: true },
    });
    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const events = await prisma.pipelineEvent.findMany({
      where: { candidateId: params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, fromStage: true, toStage: true, actor: true, note: true, createdAt: true },
    });
    return NextResponse.json({ stage: candidate.pipelineStage, stages: STAGES, events });
  } catch (err) {
    return apiError(err);
  }
}

// PATCH /api/candidates/[id]/pipeline  { stage, note? } — move the candidate to a
// new pipeline stage, recording a PipelineEvent + audit entry. No-op if unchanged.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;
    const body = await req.json().catch(() => ({}));
    const stage = body?.stage as PipelineStage;
    const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
    if (!STAGES.includes(stage)) return NextResponse.json({ error: "Invalid stage" }, { status: 400 });

    const current = await prisma.candidate.findUnique({ where: { id: params.id }, select: { pipelineStage: true } });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (current.pipelineStage === stage && !note) {
      return NextResponse.json({ ok: true, stage, unchanged: true });
    }

    await prisma.candidate.update({ where: { id: params.id }, data: { pipelineStage: stage } });
    const event = await prisma.pipelineEvent.create({
      data: { candidateId: params.id, fromStage: current.pipelineStage, toStage: stage, actor: authz.actor, note },
      select: { id: true, fromStage: true, toStage: true, actor: true, note: true, createdAt: true },
    });
    await logAudit({
      actor: authz.actor, action: "PIPELINE_STAGE", targetType: "candidate", targetId: params.id,
      meta: { from: current.pipelineStage, to: stage },
    });

    return NextResponse.json({ ok: true, stage, event });
  } catch (err) {
    return apiError(err);
  }
}
