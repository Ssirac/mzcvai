import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/rbac";
import { autoIngestForBeruf } from "@/services/autoIngest";
import { matchCandidateToVacancies } from "@/services/scoring";
import { candidateProfiles } from "@/lib/candidateProfiles";
import { withCronLock } from "@/services/cron";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The whole-roster pull: collect every occupation from every ACTIVE/PENDING
// candidate's full CV (desired position, beruf, experience titles), fetch fresh
// listings for each from the fast sources, then re-match everyone. Capped so one
// run stays sane; FETCH_ALL_MAX_PROFILES tunes it.
async function runFetchAll(): Promise<{ profiles: number; vacanciesNew: number; matched: number }> {
  const candidates = await prisma.candidate.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { id: true, beruf: true, desiredPosition: true, experience: true },
  });

  const profiles = new Set<string>();
  for (const c of candidates) {
    for (const p of candidateProfiles(c)) profiles.add(p);
  }
  const cap = Math.max(1, parseInt(process.env.FETCH_ALL_MAX_PROFILES ?? "15"));
  const list = Array.from(profiles).slice(0, cap);

  let vacanciesNew = 0;
  for (const beruf of list) {
    try {
      const r = await autoIngestForBeruf(beruf, "Deutschland");
      vacanciesNew += r.vacanciesNew;
    } catch { /* one bad occupation/source must not stop the pull */ }
  }

  let matched = 0;
  for (const c of candidates) {
    try {
      const m = await matchCandidateToVacancies(c.id);
      matched += m.matched;
    } catch { /* keep going */ }
  }

  return { profiles: list.length, vacanciesNew, matched };
}

// POST /api/candidates/fetch-all — the "Elanları çək" button with NO candidate
// selected: pull fresh listings for every active candidate's occupation right
// now instead of waiting for the 4-hourly refresh. Runs DETACHED under a lock
// (a whole-roster pull can exceed the HTTP budget, and a double-click must not
// run it twice) and answers 202 immediately; new matches surface within minutes.
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "candidate.write");
    if (!authz.ok) return authz.response;

    void withCronLock("fetch-all-manual", 20 * 60 * 1000, runFetchAll)
      .then((o) => {
        if (o.ran) log.info("fetch-all.done", { ...(o.result ?? {}) });
        else log.info("fetch-all.skipped_locked", {});
      })
      .catch((e) => log.error("fetch-all.failed", { error: (e as Error).message }));

    return NextResponse.json({ ok: true, started: true }, { status: 202 });
  } catch (err) {
    return apiError(err);
  }
}
