import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { sweepDeadVacancies } from "@/services/scraper/deadCheck";
import { withCronLock } from "@/services/cron";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { authorize } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/vacancies/sweep-dead — manual "delete dead listings" trigger for the
 * candidates page button. Checks ACTIVE vacancy URLs across ALL sources (not just
 * stale ones) and removes the dead ones, within a ~4.5 min budget so the request
 * completes. Visiting URLs is slow, so it processes as many as it can per click —
 * the returned `checked`/`deleted`/`expired` tell the user; click again to continue.
 *
 * Each run is recorded as a CronRun ("dead-sweep-manual") with its counts and an
 * audit entry, so a reviewer (the client/employer) can see in System → Cron runs
 * exactly when the listings were cleaned and how many were removed.
 */
export async function POST(req: NextRequest) {
  try {
    const authz = await authorize(req, "admin.maintenance");
    if (!authz.ok) return authz.response;
    const actor = await getSessionUser(req);
    const outcome = await withCronLock("dead-sweep-manual", 300_000, () =>
      sweepDeadVacancies({
        limit: 400,
        notSeenMins: 0,   // check everything, not only stale rows
        delayMs: 300,
        maxMs: 260_000,   // stay within maxDuration
      })
    );

    if (!outcome.ran) {
      // Another sweep is already running — tell the client to wait.
      return NextResponse.json({ ok: false, running: true, error: "Təmizləmə artıq işləyir, bir az sonra yenidən yoxlayın." }, { status: 409 });
    }

    const result = outcome.result ?? { checked: 0, deleted: 0, expired: 0 };
    await logAudit({
      actor,
      action: "DEAD_SWEEP",
      targetType: "vacancy",
      targetId: `checked:${result.checked}`,
      meta: { checked: result.checked, deleted: result.deleted, expired: result.expired },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiError(err);
  }
}
