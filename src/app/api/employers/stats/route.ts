import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PART_TIME_TITLE_KEYWORDS, PART_TIME_HARD_KEYWORDS } from "@/lib/berufMap";

export const dynamic = "force-dynamic";

// GET /api/employers/stats — dashboard counters
export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    // Full-time only — exclude any part-time/mini-job listing from the feed.
    const notPartTime = {
      NOT: {
        OR: [
          ...PART_TIME_TITLE_KEYWORDS.map((kw) => ({ title: { contains: kw, mode: "insensitive" as const } })),
          ...PART_TIME_HARD_KEYWORDS.map((kw) => ({ description: { contains: kw, mode: "insensitive" as const } })),
        ],
      },
    };

    const [
      newEmployers,
      newVacancies,
      sponsorshipReady,
      berufBreakdown,
      topEmployers,
      recentVacancies,
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
      prisma.vacancy.findMany({
        where: { status: "ACTIVE", ...notPartTime },
        orderBy: { foundAt: "desc" },
        take: 30,
        select: {
          id: true,
          title: true,
          beruf: true,
          region: true,
          url: true,
          source: true,
          foundAt: true,
          employer: { select: { name: true, genericEmail: true, sponsorshipSignal: true } },
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
      recentVacancies,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
