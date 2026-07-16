import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import type { PipelineStage } from "@prisma/client";

export const dynamic = "force-dynamic";

// Canonical order of the recruiter placement pipeline (intake → placement).
const PIPELINE_ORDER: PipelineStage[] = [
  "NEW", "PROFILE_READY", "MATCHED", "PRESENTED", "INTERVIEW", "VISA", "PLACED", "REJECTED", "ARCHIVED",
];

/**
 * GET /api/funnel — dashboard analytics in three parts:
 *  - stages:   the outreach funnel (ingested → … → placed), one count each.
 *  - pipeline: candidate distribution across the NEW→PLACED placement pipeline.
 *  - sources:  per job-source quality — how vacancies from each source convert
 *              through matched → sent → replied → placed, so low-yield sources
 *              (StepStone-style dead ends) are visible next to real ones.
 */
export async function GET() {
  try {
    const [
      ingested, matched, reviewed, sent, delivered, replied, interview, placed,
      pipelineGroups, sourceGroups,
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
      prisma.candidate.groupBy({ by: ["pipelineStage"], _count: { _all: true } }),
      prisma.vacancy.groupBy({ by: ["source"], _count: { _all: true } }),
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

    // Pipeline stage distribution, in canonical order (zero-filled).
    const pipelineCounts = new Map<string, number>(
      pipelineGroups.map((g) => [g.pipelineStage, g._count._all]),
    );
    const pipeline = PIPELINE_ORDER.map((stage) => ({ stage, count: pipelineCounts.get(stage) ?? 0 }));

    // Source quality: for each source run the conversion counts in parallel.
    const sources = await Promise.all(
      sourceGroups
        .sort((a, b) => b._count._all - a._count._all)
        .map(async (g) => {
          const source = g.source;
          const [srcMatched, srcSent, srcReplied, srcPlaced] = await Promise.all([
            prisma.match.count({ where: { vacancy: { source } } }),
            prisma.outreach.count({ where: { sentAt: { not: null }, match: { vacancy: { source } } } }),
            prisma.outreach.count({ where: { repliedAt: { not: null }, match: { vacancy: { source } } } }),
            prisma.match.count({ where: { status: "PLACED", vacancy: { source } } }),
          ]);
          return {
            source,
            vacancies: g._count._all,
            matched: srcMatched,
            sent: srcSent,
            replied: srcReplied,
            placed: srcPlaced,
            // Reply-per-sent rate is the clearest "is this source actionable" signal.
            replyRate: srcSent > 0 ? Math.round((srcReplied / srcSent) * 100) : 0,
          };
        }),
    );

    return NextResponse.json({ stages, pipeline, sources });
  } catch (err) {
    return apiError(err);
  }
}
