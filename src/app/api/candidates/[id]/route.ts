import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const body = await req.json();
    const status = body.status;
    if (!["ACTIVE", "PENDING", "PLACED", "ARCHIVED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const candidate = await prisma.candidate.update({
      where: { id: params.id },
      data: { status },
    });
    return NextResponse.json({ ok: true, candidate });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/candidates/[id] — remove candidate and all dependent records
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const matchIds = (
      await prisma.match.findMany({ where: { candidateId: params.id }, select: { id: true } })
    ).map((m) => m.id);

    await prisma.outreach.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { candidateId: params.id } });
    await prisma.candidate.delete({ where: { id: params.id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
