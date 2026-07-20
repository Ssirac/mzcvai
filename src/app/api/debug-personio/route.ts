import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostic — why don't Personio jobs reach candidates?
export async function GET(req: NextRequest) {
  const authz = await authorize(req, "admin.maintenance");
  if (!authz.ok) return authz.response;

  const active = await prisma.vacancy.findMany({
    where: { source: "personio", status: "ACTIVE" },
    select: {
      id: true, title: true, beruf: true, region: true, status: true, postedAt: true, lastSeenAt: true,
      applyChannel: true, applyValue: true, url: true,
      employer: { select: { name: true, genericEmail: true, region: true } },
      matches: { select: { candidateId: true, fitScore: true } },
    },
    take: 30,
  });
  const totalActive = await prisma.vacancy.count({ where: { source: "personio", status: "ACTIVE" } });
  const totalAny = await prisma.vacancy.count({ where: { source: "personio" } });
  const matchCount = await prisma.match.count({ where: { vacancy: { source: "personio" } } });

  return NextResponse.json({
    totalAny,
    totalActive,
    matchCount,
    sample: active.map((v) => ({
      title: v.title, beruf: v.beruf, region: v.region, status: v.status,
      postedAt: v.postedAt, lastSeenAt: v.lastSeenAt,
      apply: v.applyChannel, employer: v.employer?.name, employerEmail: v.employer?.genericEmail,
      matchCount: v.matches.length,
    })),
  });
}
