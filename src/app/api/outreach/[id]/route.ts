import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { approveOutreach, sendOutreach } from "@/services/outreach";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { prisma } from "@/lib/prisma";

// PATCH /api/outreach/[id] — action: approve | send | update-draft
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { action, draftBody, subject } = await req.json();
    const id = params.id;
    // The approver/sender is the logged-in user, not a client-supplied value.
    const actor = await getSessionUser(req);

    if (action === "approve") {
      await approveOutreach(id, actor ?? "unknown");
      await logAudit({ actor, action: "OUTREACH_APPROVE", targetType: "outreach", targetId: id });
      return NextResponse.json({ ok: true, status: "APPROVED" });
    }

    if (action === "send") {
      await sendOutreach(id);
      await logAudit({ actor, action: "OUTREACH_SEND", targetType: "outreach", targetId: id });
      return NextResponse.json({ ok: true, status: "SENT" });
    }

    if (action === "update-draft") {
      await prisma.outreach.update({
        where: { id },
        data: {
          ...(draftBody ? { draftBody } : {}),
          ...(subject ? { subject } : {}),
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return apiError(err);
  }
}

// DELETE /api/outreach/[id] — remove an outreach record. Used to clean up a
// DRAFT/APPROVED that never sent (failed/abandoned), so it doesn't linger. Never
// deletes a SENT record (that's real history).
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const o = await prisma.outreach.findUnique({ where: { id: params.id }, select: { status: true, sentAt: true } });
    if (!o) return NextResponse.json({ ok: true });
    if (o.status === "SENT" || o.sentAt) { // dispatched (incl. REPLIED) = real history
      return NextResponse.json({ error: "Cannot delete a sent outreach" }, { status: 400 });
    }
    await prisma.outreach.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
