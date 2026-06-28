import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/admin/reset — dev only, clears all app data
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed in production" }, { status: 403 });
  }
  await prisma.outreach.deleteMany();
  await prisma.match.deleteMany();
  await prisma.employerSignalLog.deleteMany();
  await prisma.vacancy.deleteMany();
  await prisma.employer.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.ingestionRun.deleteMany();
  return NextResponse.json({ ok: true });
}
