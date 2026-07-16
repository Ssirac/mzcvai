import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";
import type { DocType, DocStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// Core visa-readiness checklist shown for every candidate (stored rows override).
const CHECKLIST: DocType[] = ["PASSPORT", "DIPLOMA", "LANGUAGE_CERT", "CV", "PHOTO", "VISA"];
const ALL_TYPES: DocType[] = [...CHECKLIST, "CERTIFICATE", "OTHER"];
const STATUSES: DocStatus[] = ["MISSING", "UPLOADED", "VERIFIED"];

// GET /api/candidates/[id]/documents — checklist merged with stored rows + %.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.read");
    if (!authz.ok) return authz.response;
    const rows = await prisma.candidateDocument.findMany({
      where: { candidateId: params.id },
      select: { type: true, status: true, note: true, updatedAt: true },
    });
    const byType = new Map(rows.map((r) => [r.type, r]));
    // Show every checklist item; append any stored non-checklist types too.
    const types = Array.from(new Set<DocType>([...CHECKLIST, ...rows.map((r) => r.type)]));
    const items = types.map((type) => {
      const r = byType.get(type);
      return { type, status: (r?.status ?? "MISSING") as DocStatus, note: r?.note ?? null, updatedAt: r?.updatedAt ?? null };
    });
    const verified = items.filter((i) => i.status === "VERIFIED").length;
    const done = items.filter((i) => i.status !== "MISSING").length;
    const completionPct = items.length ? Math.round((done / items.length) * 100) : 0;
    return NextResponse.json({ items, verified, total: items.length, completionPct, statuses: STATUSES });
  } catch (err) {
    return apiError(err);
  }
}

// PATCH /api/candidates/[id]/documents  { type, status, note? } — upsert one item.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;
    const body = await req.json().catch(() => ({}));
    const type = body?.type as DocType;
    const status = body?.status as DocStatus;
    const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
    if (!ALL_TYPES.includes(type)) return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    if (!STATUSES.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

    const saved = await prisma.candidateDocument.upsert({
      where: { candidateId_type: { candidateId: params.id, type } },
      create: { candidateId: params.id, type, status, note },
      update: { status, note },
      select: { type: true, status: true, note: true, updatedAt: true },
    });
    await logAudit({
      actor: authz.actor, action: "DOCUMENT_UPDATE", targetType: "candidate", targetId: params.id,
      meta: { type, status },
    });
    return NextResponse.json({ ok: true, item: saved });
  } catch (err) {
    return apiError(err);
  }
}
