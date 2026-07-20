import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { freshVacancyWhere, notRejectedWhere } from "@/lib/matchFilters";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostic — why don't Personio jobs reach candidates?
export async function GET(req: NextRequest) {
  const authz = await authorize(req, "admin.maintenance");
  if (!authz.ok) return authz.response;

  const totalActive = await prisma.vacancy.count({ where: { source: "personio", status: "ACTIVE" } });
  const matchCountRaw = await prisma.match.count({ where: { vacancy: { source: "personio" } } });

  // How many personio matches survive the candidate-view filter?
  const matchCountFresh = await prisma.match.count({
    where: { vacancy: { source: "personio", ...freshVacancyWhere() }, ...notRejectedWhere() },
  });

  // How many personio vacancies individually pass freshVacancyWhere?
  const freshVacCount = await prisma.vacancy.count({
    where: { source: "personio", ...freshVacancyWhere() },
  });

  // Which candidates hold personio matches, and do those matches survive the view filter?
  const rawMatches = await prisma.match.findMany({
    where: { vacancy: { source: "personio" } },
    select: {
      id: true, feedback: true,
      candidate: { select: { name: true } },
      vacancy: { select: { title: true, region: true, status: true, postedAt: true, lastSeenAt: true, employmentType: true } },
    },
    take: 20,
  });

  return NextResponse.json({
    totalActive,
    matchCountRaw,
    matchCountFresh,   // <-- if this is 0 while raw>0, the VIEW filter drops them
    freshVacCount,     // <-- if 0 while totalActive>0, freshVacancyWhere drops the vacancies
    matches: rawMatches.map((m) => ({
      candidate: m.candidate?.name, feedback: m.feedback,
      title: m.vacancy?.title, region: m.vacancy?.region, status: m.vacancy?.status,
      postedAt: m.vacancy?.postedAt, lastSeenAt: m.vacancy?.lastSeenAt, empType: m.vacancy?.employmentType,
    })),
  });
}
