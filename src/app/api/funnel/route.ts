import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/funnel — the recruiting pipeline funnel for the dashboard:
 * ingested → matched → reviewed → sent → delivered → replied → interview → placed.
 * Each stage is a single count so the UI can render a simple funnel bar.
 */
export async function GET() {
  try {
    const [
      ingested, matched, reviewed, sent, delivered, replied, interview, placed,
    ] = await Promise.all([
      prisma.vacancy.count({ where: { status: "ACTIVE" } }),
      prisma.match.count(),
      // "reviewed" = a recruiter acted on it (feedback) or an outreach exists.
      prisma.match.count({ where: { OR: [{ feedback: { not: null } }, { outreach: { some: {} } }] } }),
      prisma.outreach.count({ where: { sentAt: { not: null } } }),
      prisma.outreach.count({ where: { deliveredAt: { not: null } } }),
      prisma.outreach.count({ where: { repliedAt: { not: null } } }),
      prisma.match.count({ where: { status: "INTERVIEW" } }),
      prisma.candidate.count({ where: { status: "PLACED" } }),
    ]);

    const stages = [
      { key: "ingested", count: ingested },
      { key: "matched", count: matched },
      { key: "reviewed", count: reviewed },
      { key: "sent", count: sent },
      { key: "delivered", count: delivered },
      { key: "replied", count: replied },
      { key: "interview", count: interview },
      { key: "placed", count: placed },
    ];
    return NextResponse.json({ stages });
  } catch (err) {
    return apiError(err);
  }
}
