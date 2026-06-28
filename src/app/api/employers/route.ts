import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/employers?beruf=&region=&minScore=&limit=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const beruf = searchParams.get("beruf");
  const region = searchParams.get("region");
  const minScore = parseInt(searchParams.get("minScore") ?? "0");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  try {
    const employers = await prisma.employer.findMany({
      where: {
        score: { gte: minScore },
        ...(region ? { region } : {}),
        ...(beruf
          ? { vacancies: { some: { beruf, status: "ACTIVE" } } }
          : {}),
      },
      orderBy: { score: "desc" },
      take: limit,
      include: {
        vacancies: {
          where: { status: "ACTIVE" },
          select: { id: true, title: true, beruf: true, region: true },
        },
        _count: { select: { vacancies: true, signalLogs: true } },
      },
    });

    return NextResponse.json({ employers });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
