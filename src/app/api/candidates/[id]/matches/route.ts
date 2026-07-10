import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PART_TIME_TITLE_KEYWORDS, PART_TIME_HARD_KEYWORDS } from "@/lib/berufMap";
import { matchCandidateToVacancies } from "@/services/scoring";
import { autoSendForCandidate } from "@/services/autopilot";

export const maxDuration = 120;

// GET /api/candidates/[id]/matches — get scored matches for a candidate
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Hide stale listings (30+ days old) even before the background sweep
    // deletes them, so the candidate only ever sees currently-open jobs.
    const EXPIRY_DAYS = 30;
    const expiryCutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Never SHOW part-time / mini-job listings, even if some slipped into the DB
    // before the ingest filter — full-time only.
    const partTimeOr = [
      ...PART_TIME_TITLE_KEYWORDS.map((kw) => ({ title: { contains: kw, mode: "insensitive" as const } })),
      ...PART_TIME_HARD_KEYWORDS.map((kw) => ({ description: { contains: kw, mode: "insensitive" as const } })),
    ];

    const query = () =>
      prisma.match.findMany({
        where: {
          candidateId: params.id,
          vacancy: { status: "ACTIVE", foundAt: { gte: expiryCutoff }, NOT: { OR: partTimeOr } },
        },
        orderBy: [
          { employer: { score: "desc" } },
          { fitScore: "desc" },
        ],
        include: {
          vacancy: {
            select: { title: true, beruf: true, region: true, applyChannel: true, applyValue: true, postedAt: true, url: true, source: true },
          },
          employer: {
            select: {
              name: true, city: true, region: true, stars: true, rooms: true,
              score: true, scoreBreakdown: true, sponsorshipSignal: true,
              genericEmail: true, emailSource: true, emailStatus: true,
              applyFormUrl: true, phone: true,
              website: true, optedOut: true,
            },
          },
          outreach: {
            select: { id: true, status: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

    let matches = await query();

    // Self-healing: zero matches often just means matching hasn't re-run since
    // criteria/thresholds changed or new vacancies arrived. Re-match once on
    // view so the user never stares at an unexplained empty list.
    if (matches.length === 0) {
      try {
        await matchCandidateToVacancies(params.id);
        matches = await query();
      } catch { /* keep the empty list if rematch fails */ }
    }

    // Per-candidate, per-employer cooldown: THIS candidate can't be re-sent to an
    // employer they were already sent to within COOLDOWN_DAYS. A different
    // vacancy of that same employer would otherwise still show an active "send"
    // button and fail on click, so we annotate each match so the UI can show
    // "already contacted" instead. (Other candidates are unaffected — they may
    // still apply to the same employer independently.)
    const COOLDOWN_DAYS = parseInt(process.env.OUTREACH_COOLDOWN_DAYS ?? "30");
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const employerIds = Array.from(new Set(matches.map((m) => m.employerId)));
    const recentSends = await prisma.outreach.findMany({
      where: {
        status: "SENT",
        sentAt: { gte: cooldownCutoff },
        match: { employerId: { in: employerIds }, candidateId: params.id },
      },
      select: { sentAt: true, match: { select: { employerId: true } } },
      orderBy: { sentAt: "desc" },
    });
    const cooldownByEmployer = new Map<string, string>();
    for (const r of recentSends) {
      if (r.match?.employerId && r.sentAt && !cooldownByEmployer.has(r.match.employerId)) {
        cooldownByEmployer.set(r.match.employerId, r.sentAt.toISOString());
      }
    }

    const annotated = matches.map((m) => ({
      ...m,
      employerLastSentAt: cooldownByEmployer.get(m.employerId) ?? null,
    }));

    // Auto-pilot: if any matching job hasn't been applied to yet, dispatch the
    // application(s) now (fire-and-forget). Every hard guard — CV requirement,
    // per-candidate + global daily caps, per-employer cooldown, opt-out,
    // generic-email-only, already-sent — is enforced inside the send path, so
    // this never double-sends and never blocks the response.
    const hasPending = annotated.some((m) => !m.outreach.some((o) => o.status === "SENT"));
    if (hasPending) {
      void autoSendForCandidate(params.id).catch((e) =>
        console.error("[auto-pilot] send on matches view failed:", (e as Error).message)
      );
    }

    return NextResponse.json({ matches: annotated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
