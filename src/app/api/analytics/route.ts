import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/analytics — outreach funnel + breakdowns for the dashboard.
// Counts every outreach that was actually sent (sentAt set), then the share that
// was delivered / opened / replied / bounced, plus reply-rate breakdowns by
// occupation (beruf) and region so the user can see what's working.
export async function GET() {
  try {
    const sent = await prisma.outreach.findMany({
      where: { sentAt: { not: null } },
      select: {
        status: true,
        deliveredAt: true,
        openedAt: true,
        openCount: true,
        repliedAt: true,
        bouncedAt: true,
        followUpCount: true,
        sentAt: true,
        match: {
          select: {
            vacancy: { select: { beruf: true, region: true } },
            candidate: { select: { id: true, name: true } },
          },
        },
      },
    });

    const total = sent.length;
    let delivered = 0, opened = 0, replied = 0, bounced = 0, followUps = 0;

    // beruf/region/candidate → { sent, replied }
    type Bucket = { sent: number; replied: number; opened: number };
    const byBeruf = new Map<string, Bucket>();
    const byRegion = new Map<string, Bucket>();
    const byCandidate = new Map<string, Bucket & { name: string }>();

    const bump = <T extends Bucket>(map: Map<string, T>, key: string, make: () => T, isReplied: boolean, isOpened: boolean) => {
      const b = map.get(key) ?? map.set(key, make()).get(key)!;
      b.sent++;
      if (isReplied) b.replied++;
      if (isOpened) b.opened++;
    };

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let last30Sent = 0, last30Replied = 0;

    for (const o of sent) {
      const isReplied = !!o.repliedAt || o.status === "REPLIED";
      const isOpened = !!o.openedAt || o.openCount > 0;
      if (o.deliveredAt) delivered++;
      if (isOpened) opened++;
      if (isReplied) replied++;
      if (o.bouncedAt || o.status === "BOUNCED") bounced++;
      followUps += o.followUpCount ?? 0;

      if (o.sentAt && o.sentAt >= since30) {
        last30Sent++;
        if (isReplied) last30Replied++;
      }

      const beruf = o.match?.vacancy?.beruf || "—";
      const region = o.match?.vacancy?.region || "—";
      bump(byBeruf, beruf, () => ({ sent: 0, replied: 0, opened: 0 }), isReplied, isOpened);
      bump(byRegion, region, () => ({ sent: 0, replied: 0, opened: 0 }), isReplied, isOpened);
      if (o.match?.candidate) {
        const c = o.match.candidate;
        bump(byCandidate, c.id, () => ({ sent: 0, replied: 0, opened: 0, name: c.name }), isReplied, isOpened);
      }
    }

    // Placement pipeline counts (application stages set by the user).
    const [interviews, placed] = await Promise.all([
      prisma.match.count({ where: { status: "INTERVIEW" } }),
      prisma.match.count({ where: { status: "PLACED" } }),
    ]);

    const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    const topList = <T extends Bucket>(map: Map<string, T>, withName = false) =>
      Array.from(map.entries())
        .map(([key, b]) => ({
          key,
          ...(withName ? { name: (b as Bucket & { name?: string }).name ?? key } : {}),
          sent: b.sent,
          replied: b.replied,
          opened: b.opened,
          replyRate: rate(b.replied, b.sent),
        }))
        .sort((a, b) => b.replied - a.replied || b.sent - a.sent)
        .slice(0, 12);

    return NextResponse.json({
      funnel: {
        sent: total,
        delivered, opened, replied, bounced, followUps,
        deliveryRate: rate(delivered, total),
        openRate: rate(opened, delivered || total),
        replyRate: rate(replied, total),
        bounceRate: rate(bounced, total),
      },
      pipeline: { interviews, placed },
      last30: { sent: last30Sent, replied: last30Replied, replyRate: rate(last30Replied, last30Sent) },
      byBeruf: topList(byBeruf),
      byRegion: topList(byRegion),
      byCandidate: topList(byCandidate, true),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
