import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { PART_TIME_TITLE_KEYWORDS, PART_TIME_HARD_KEYWORDS } from "@/lib/berufMap";

// POST /api/cleanup-parttime
// Removes existing part-time / mini-job vacancies from the DB — by title keyword
// OR an unambiguous mini-job signal in the description (Minijob, 520-Euro, etc.).
// Ingest already filters these going forward; this cleans what's already stored.
// Vacancies tied to a SENT outreach are kept (preserves history). FK-safe.
export async function POST() {
  try {
    const titleOr = PART_TIME_TITLE_KEYWORDS.map((kw) => ({
      title: { contains: kw, mode: "insensitive" as const },
    }));
    const descOr = PART_TIME_HARD_KEYWORDS.map((kw) => ({
      description: { contains: kw, mode: "insensitive" as const },
    }));

    const ptVacancies = await prisma.vacancy.findMany({
      where: {
        OR: [...titleOr, ...descOr],
        matches: { none: { outreach: { some: { status: "SENT" } } } },
      },
      select: { id: true, matches: { select: { id: true } } },
    });

    const ptIds = ptVacancies.map((v) => v.id);
    const ptMatchIds = ptVacancies.flatMap((v) => v.matches.map((m) => m.id));

    let deleted = 0;
    if (ptIds.length > 0) {
      await prisma.outreach.deleteMany({ where: { matchId: { in: ptMatchIds } } });
      await prisma.match.deleteMany({ where: { id: { in: ptMatchIds } } });
      const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ptIds } } });
      deleted = count;
    }

    return NextResponse.json({ ok: true, partTimeDeleted: deleted });
  } catch (err) {
    return apiError(err);
  }
}
