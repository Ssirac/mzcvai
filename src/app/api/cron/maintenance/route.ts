import { NextRequest, NextResponse } from "next/server";
import { pollReplies } from "@/services/replies";
import { runFollowUps } from "@/services/followup";
import { deletePartTimeVacancies } from "@/services/cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/cron/maintenance?job=replies|followups|cleanup|all
// Secret-guarded (x-cron-secret) recurring maintenance, called by the in-process
// scheduler (src/instrumentation.ts) and usable by any external cron too.
// Runs in the Node.js runtime so IMAP (imapflow) and SMTP (nodemailer) work.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = req.nextUrl.searchParams.get("job") ?? "all";
  const log: Record<string, unknown> = {};

  try {
    if (job === "replies" || job === "all") {
      log.replies = await pollReplies();
    }
    // Keep the DB full-time-only on every pass.
    if (job === "cleanup" || job === "replies" || job === "all") {
      log.cleanup = await deletePartTimeVacancies();
    }
    if (job === "followups" || job === "all") {
      // Make sure replies are current right before follow-ups, so we never chase
      // an employer who already answered.
      if (job === "followups") log.replies = await pollReplies();
      log.followups = await runFollowUps();
    }
    return NextResponse.json({ ok: true, job, ...log });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message, ...log }, { status: 500 });
  }
}
