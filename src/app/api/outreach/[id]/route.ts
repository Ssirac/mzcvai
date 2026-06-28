import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { approveOutreach, sendOutreach } from "@/services/outreach";
import { prisma } from "@/lib/prisma";

// PATCH /api/outreach/[id] — action: approve | send | update-draft
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { action, userId, draftBody, subject } = await req.json();
    const id = params.id;

    if (action === "approve") {
      if (!userId) return NextResponse.json({ error: "userId required for approval" }, { status: 400 });
      await approveOutreach(id, userId);
      return NextResponse.json({ ok: true, status: "APPROVED" });
    }

    if (action === "send") {
      await sendOutreach(id);
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
