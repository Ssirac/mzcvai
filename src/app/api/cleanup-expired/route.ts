import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

// POST /api/cleanup-expired
// One-off (and repeatable) sweep that deletes vacancies older than EXPIRY_DAYS.
// Same logic ingest now runs automatically after every fetch — exposed here so
// the existing DB can be cleaned immediately without waiting for a new ingest.
// A vacancy is kept if any of its matches has a SENT outreach (preserves
// "Göndərilən maillər" history for employers already contacted).
export async function POST() {
  try {
    const EXPIRY_DAYS = 30;
    const expiryCutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const staleVacancies = await prisma.vacancy.findMany({
      where: {
        foundAt: { lt: expiryCutoff },
        matches: { none: { outreach: { some: { status: "SENT" } } } },
      },
      select: { id: true, matches: { select: { id: true } } },
    });
    const staleVacancyIds = staleVacancies.map((v) => v.id);
    const staleMatchIds = staleVacancies.flatMap((v) => v.matches.map((m) => m.id));

    let expiredDeleted = 0;
    if (staleVacancyIds.length > 0) {
      await prisma.outreach.deleteMany({ where: { matchId: { in: staleMatchIds } } });
      await prisma.match.deleteMany({ where: { id: { in: staleMatchIds } } });
      const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: staleVacancyIds } } });
      expiredDeleted = count;
    }

    return NextResponse.json({ ok: true, expiredDeleted, cutoffDays: EXPIRY_DAYS });
  } catch (err) {
    return apiError(err);
  }
}
