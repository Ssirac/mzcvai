import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/rbac";
import { enrichPendingEmployers } from "@/services/enrichment";
import { scoreEmployersForSearch } from "@/services/scoring";

// POST /api/enrich — run enrichment then re-score
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(body.limit ?? 20, 50);
    const beruf: string = body.beruf ?? "Housekeeping";
    const region: string = body.region ?? "Deutschland";

    const enrichResult = await enrichPendingEmployers(limit);

    // Re-score after enrichment since signals may have changed
    const scored = await scoreEmployersForSearch(beruf, region);

    return NextResponse.json({ ok: true, ...enrichResult, employersRescored: scored });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
