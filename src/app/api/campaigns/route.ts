import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns — outreach funnel grouped by campaign (+ template version):
 * sent / delivered / opened / replied / bounced, with derived reply & bounce
 * rates. Powers campaign attribution analytics.
 */
export async function GET() {
  try {
    const rows = await prisma.outreach.findMany({
      where: { sentAt: { not: null } },
      select: { campaign: true, templateVersion: true, deliveredAt: true, openedAt: true, openCount: true, repliedAt: true, bouncedAt: true },
    });

    type Agg = { campaign: string; templateVersion: string; sent: number; delivered: number; opened: number; replied: number; bounced: number };
    const map = new Map<string, Agg>();
    for (const o of rows) {
      const campaign = o.campaign ?? "default";
      const templateVersion = o.templateVersion ?? "—";
      const key = `${campaign}|${templateVersion}`;
      const a = map.get(key) ?? { campaign, templateVersion, sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0 };
      a.sent++;
      if (o.deliveredAt) a.delivered++;
      if (o.openedAt || o.openCount > 0) a.opened++;
      if (o.repliedAt) a.replied++;
      if (o.bouncedAt) a.bounced++;
      map.set(key, a);
    }

    const campaigns = Array.from(map.values())
      .map((a) => ({
        ...a,
        replyRate: a.sent ? Number((a.replied / a.sent).toFixed(3)) : 0,
        bounceRate: a.sent ? Number((a.bounced / a.sent).toFixed(3)) : 0,
      }))
      .sort((x, y) => y.sent - x.sent);

    return NextResponse.json({ campaigns, total: rows.length });
  } catch (err) {
    return apiError(err);
  }
}
