import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { buildApplicationFields, APPLICATION_CANDIDATE_SELECT } from "@/lib/applicationFields";

export const dynamic = "force-dynamic";

/**
 * GET /api/candidates/[id]/prefill — candidate data mapped to common German
 * application-form fields, for the "MZ Autofill" browser extension (Feature 2).
 *
 * The extension calls this with credentials:"include" — the admin's existing MZ
 * session cookie authenticates it (enforced by middleware); no separate token.
 * It fills form fields client-side after the human clears any captcha; this
 * endpoint never touches the external site.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const c = await prisma.candidate.findUnique({
      where: { id: params.id },
      select: APPLICATION_CANDIDATE_SELECT,
    });
    if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    // Field mapping now lives in @/lib/applicationFields so the server-side
    // auto-apply engine fills the exact same values as this human-facing prefill.
    const { fields, cv } = buildApplicationFields(c);
    return NextResponse.json({ candidateId: params.id, fields, cv });
  } catch (err) {
    return apiError(err);
  }
}
