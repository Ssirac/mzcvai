import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { occupationRelevant } from "@/services/scoring";
import { candidateProfiles } from "@/lib/candidateProfiles";

// GET /api/candidates/[id]/outreach — full communication history for a candidate:
// which employers/vacancies were contacted, what was sent, and the status.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    // Purge stale, never-sent drafts (older than 5 min) for this candidate so old
    // abandoned attempts don't pile up. A fresh in-progress send completes in
    // seconds, so this never touches an active one.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.outreach.deleteMany({
      where: {
        match: { candidateId: params.id },
        status: { not: "SENT" },
        sentAt: null,
        createdAt: { lt: fiveMinAgo },
      },
    });

    // Only show outreach that was actually SENT — drafts that never went out
    // (e.g. a failed/abandoned send) must not clutter the "Sent emails" tab.
    const outreach = await prisma.outreach.findMany({
      where: {
        match: { candidateId: params.id },
        OR: [{ status: "SENT" }, { sentAt: { not: null } }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        subject: true,
        draftBody: true,
        toAddress: true,
        channel: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        openCount: true,
        repliedAt: true,
        replyText: true,
        replyFrom: true,
        replySubject: true,
        bouncedAt: true,
        followUpCount: true,
        lastFollowUpAt: true,
        matchId: true,
        match: {
          select: {
            status: true,
            employer: { select: { name: true, city: true, region: true, sponsorshipSignal: true } },
            vacancy: { select: { title: true, url: true, source: true } },
          },
        },
      },
    });

    // Relevance audit against the candidate's FULL CV profiles: flag any sent
    // application whose vacancy title is outside every occupation the CV shows,
    // so the recruiter can see at a glance which past sends were off-profile.
    const candidate = await prisma.candidate.findUnique({
      where: { id: params.id },
      select: { beruf: true, desiredPosition: true, experience: true },
    });
    const profiles = candidate ? candidateProfiles(candidate) : [];
    const audited = outreach.map((o) => ({
      ...o,
      relevant:
        profiles.length === 0 ||
        profiles.some((p) => occupationRelevant(p, o.match.vacancy.title)),
    }));

    const counts = outreach.reduce(
      (acc, o) => {
        acc.total++;
        if (o.status === "SENT" || o.sentAt) acc.sent++;
        if (o.status === "DRAFT") acc.draft++;
        if (o.openedAt || o.openCount > 0) acc.opened++;
        if (o.status === "REPLIED" || o.repliedAt) acc.replied++;
        if (o.status === "BOUNCED" || o.bouncedAt) acc.bounced++;
        return acc;
      },
      { total: 0, sent: 0, draft: 0, opened: 0, replied: 0, bounced: 0 }
    );

    return NextResponse.json({ outreach: audited, counts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
