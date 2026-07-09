/**
 * Part-time / mini-job purge. The agency places full-time candidates only, so
 * these listings must never appear and must not linger in the DB. Ingest filters
 * them on the way in, the read queries hide any that slipped through, and this
 * runs on a schedule (hourly via the maintenance cron) to delete them outright.
 *
 * A vacancy is matched by a part-time title keyword OR an unambiguous mini-job
 * signal in the description (Minijob, 520-Euro, geringfügig, "nur Teilzeit").
 * Vacancies tied to a SENT outreach are kept so application history survives.
 * FK-safe: Outreach → Match → Vacancy.
 */

import { prisma } from "@/lib/prisma";
import { PART_TIME_TITLE_KEYWORDS, PART_TIME_HARD_KEYWORDS, isNonGermanLocation } from "@/lib/berufMap";

// Vacancies not re-seen in EXPIRY_DAYS are stale job postings — most German
// listings are filled or pulled within a month. Delete them so candidates only
// ever see currently-open jobs. Kept if tied to a SENT outreach (history).
export async function deleteExpiredVacancies(expiryDays = 30): Promise<{ expiredDeleted: number }> {
  const cutoff = new Date(Date.now() - expiryDays * 24 * 60 * 60 * 1000);

  const stale = await prisma.vacancy.findMany({
    where: {
      foundAt: { lt: cutoff },
      matches: { none: { outreach: { some: { status: "SENT" } } } },
    },
    select: { id: true, matches: { select: { id: true } } },
  });

  const ids = stale.map((v) => v.id);
  const matchIds = stale.flatMap((v) => v.matches.map((m) => m.id));

  let expiredDeleted = 0;
  if (ids.length > 0) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ids } } });
    expiredDeleted = count;
  }

  return { expiredDeleted };
}

// Germany-only guard: purge any vacancy whose employer/vacancy location names a
// place OUTSIDE Germany (Austria, Switzerland, etc.). The precise word-boundary
// check runs in JS — a raw DB `contains` would wrongly hit German names like
// "Bernau" (contains "bern"). Vacancies tied to a SENT outreach are kept.
export async function deleteNonGermanVacancies(): Promise<{ nonGermanDeleted: number }> {
  const vacancies = await prisma.vacancy.findMany({
    where: { matches: { none: { outreach: { some: { status: "SENT" } } } } },
    select: {
      id: true,
      region: true,
      matches: { select: { id: true } },
      employer: { select: { city: true, region: true } },
    },
  });

  const foreign = vacancies.filter((v) =>
    isNonGermanLocation(`${v.employer?.city ?? ""} ${v.employer?.region ?? ""} ${v.region ?? ""}`)
  );

  const ids = foreign.map((v) => v.id);
  const matchIds = foreign.flatMap((v) => v.matches.map((m) => m.id));

  let nonGermanDeleted = 0;
  if (ids.length > 0) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: matchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ids } } });
    nonGermanDeleted = count;
  }

  return { nonGermanDeleted };
}

export async function deletePartTimeVacancies(): Promise<{ partTimeDeleted: number }> {
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

  let partTimeDeleted = 0;
  if (ptIds.length > 0) {
    await prisma.outreach.deleteMany({ where: { matchId: { in: ptMatchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: ptMatchIds } } });
    const { count } = await prisma.vacancy.deleteMany({ where: { id: { in: ptIds } } });
    partTimeDeleted = count;
  }

  return { partTimeDeleted };
}
