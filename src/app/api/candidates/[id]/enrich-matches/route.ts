import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { enrichMatchesForCandidate } from "@/services/enrichment";

export const maxDuration = 300;

// POST /api/candidates/[id]/enrich-matches
// Finds generic application emails for every employer matched to this candidate
// that doesn't already have one (listing-text first, then website scraping).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await enrichMatchesForCandidate(params.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
