import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import type { CrmStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const CRM_STATUSES: CrmStatus[] = ["LEAD", "CONTACTED", "ACTIVE", "PARTNER", "DORMANT", "BLOCKED"];

// GET /api/employers/[id]/crm — CRM fields + follow-up trail.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authz = await authorize(req, "candidate.read"); // recruiter-level read
    if (!authz.ok) return authz.response;
    const employer = await prisma.employer.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, crmStatus: true, crmNotes: true, lastContactAt: true },
    });
    if (!employer) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const followUps = await prisma.employerFollowUp.findMany({
      where: { employerId: params.id },
      orderBy: { contactedAt: "desc" },
      take: 50,
      select: { id: true, contactedAt: true, outcome: true, nextStep: true, nextStepDueAt: true, actor: true },
    });
    return NextResponse.json({ ...employer, statuses: CRM_STATUSES, followUps });
  } catch (err) {
    return apiError(err);
  }
}

// PATCH /api/employers/[id]/crm  { crmStatus?, crmNotes? } — update CRM fields.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authz = await authorize(req, "candidate.write"); // recruiter-level write
    if (!authz.ok) return authz.response;
    const body = await req.json().catch(() => ({}));
    const data: { crmStatus?: CrmStatus; crmNotes?: string } = {};
    if (body?.crmStatus !== undefined) {
      if (!CRM_STATUSES.includes(body.crmStatus)) return NextResponse.json({ error: "Invalid crmStatus" }, { status: 400 });
      data.crmStatus = body.crmStatus;
    }
    if (typeof body?.crmNotes === "string") data.crmNotes = body.crmNotes.slice(0, 5000);
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const updated = await prisma.employer.update({
      where: { id: params.id }, data,
      select: { crmStatus: true, crmNotes: true, lastContactAt: true },
    });
    await logAudit({ actor: authz.actor, action: "EMPLOYER_UPDATE", targetType: "employer", targetId: params.id, meta: { fields: Object.keys(data) } });
    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    return apiError(err);
  }
}

// POST /api/employers/[id]/crm  { outcome?, nextStep?, nextStepDueAt? } — log a
// follow-up touchpoint; also bumps lastContactAt.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;
    const body = await req.json().catch(() => ({}));
    const outcome = typeof body?.outcome === "string" ? body.outcome.slice(0, 1000) : null;
    const nextStep = typeof body?.nextStep === "string" ? body.nextStep.slice(0, 1000) : null;
    const dueRaw = body?.nextStepDueAt ? new Date(body.nextStepDueAt) : null;
    const nextStepDueAt = dueRaw && !isNaN(dueRaw.getTime()) ? dueRaw : null;
    if (!outcome && !nextStep) return NextResponse.json({ error: "outcome or nextStep required" }, { status: 400 });

    const now = new Date();
    const followUp = await prisma.employerFollowUp.create({
      data: { employerId: params.id, contactedAt: now, outcome, nextStep, nextStepDueAt, actor: authz.actor },
      select: { id: true, contactedAt: true, outcome: true, nextStep: true, nextStepDueAt: true, actor: true },
    });
    await prisma.employer.update({ where: { id: params.id }, data: { lastContactAt: now } }).catch(() => {});
    await logAudit({ actor: authz.actor, action: "FOLLOWUP_ADD", targetType: "employer", targetId: params.id, meta: { hasNextStep: !!nextStep } });
    return NextResponse.json({ ok: true, followUp });
  } catch (err) {
    return apiError(err);
  }
}
