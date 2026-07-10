import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchCandidateToVacancies } from "@/services/scoring";
import { autoIngestForBeruf } from "@/services/autoIngest";
import { autoSendForCandidate } from "@/services/autopilot";

// GET /api/matches?candidateId=
export async function GET(req: NextRequest) {
  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  }
  try {
    const matches = await prisma.match.findMany({
      where: { candidateId },
      orderBy: { fitScore: "desc" },
      include: {
        vacancy: { select: { title: true, beruf: true, region: true } },
        employer: {
          select: {
            name: true, city: true, score: true,
            sponsorshipSignal: true, scoreBreakdown: true,
          },
        },
      },
    });
    return NextResponse.json({ matches });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/matches — run matching for a candidate
export async function POST(req: NextRequest) {
  try {
    const { candidateId } = await req.json();
    if (!candidateId) {
      return NextResponse.json({ error: "candidateId required" }, { status: 400 });
    }
    let result = await matchCandidateToVacancies(candidateId);
    let autoIngest: { vacanciesNew: number; sources: string[] } | null = null;

    // Auto-fetch jobs for this profession if few/none matched, then re-match
    if (result.matched < 5) {
      const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { beruf: true, desiredPosition: true, regionPrefs: true } });
      if (candidate) {
        const region = candidate.regionPrefs.length && !candidate.regionPrefs.includes("Deutschland")
          ? candidate.regionPrefs[0]
          : "Deutschland";
        const profile = [candidate.beruf, candidate.desiredPosition].filter(Boolean).join(" / ");
        autoIngest = await autoIngestForBeruf(profile, region);
        if (autoIngest.vacanciesNew > 0) result = await matchCandidateToVacancies(candidateId);
      }
    }

    // Auto-pilot: a suitable job for this candidate → send the application right
    // away (fire-and-forget). The send path enforces CV, caps, cooldown, opt-out
    // and generic-email-only, and skips anything already sent — so this only
    // dispatches genuinely new, eligible matches.
    void autoSendForCandidate(candidateId).catch((e) =>
      console.error("[auto-pilot] send on match view failed:", (e as Error).message)
    );

    return NextResponse.json({ ok: true, ...result, autoIngest });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
