import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/employers/stats — dashboard counters
export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    const [
      newEmployers,
      newVacancies,
      sponsorshipReady,
      berufBreakdown,
      topEmployers,
    ] = await Promise.all([
      prisma.employer.count({ where: { createdAt: { gte: since } } }),
      prisma.vacancy.count({ where: { foundAt: { gte: since } } }),
      prisma.employer.count({
        where: {
          sponsorshipSignal: { in: ["YES", "LIKELY"] },
          vacancies: { some: { status: "ACTIVE" } },
        },
      }),
      prisma.vacancy.groupBy({
        by: ["beruf"],
        where: { status: "ACTIVE" },
        _count: { _all: true },
        orderBy: { _count: { beruf: "desc" } },
        take: 8,
      }),
      prisma.employer.findMany({
        where: { score: { gt: 0 } },
        orderBy: { score: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          city: true,
          region: true,
          score: true,
          scoreBreakdown: true,
          sponsorshipSignal: true,
          _count: { select: { vacancies: true } },
        },
      }),
    ]);

    return NextResponse.json({
      newEmployers,
      newVacancies,
      sponsorshipReady,
      berufBreakdown: berufBreakdown.map((b) => ({
        beruf: b.beruf,
        count: b._count._all,
      })),
      topEmployers,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
