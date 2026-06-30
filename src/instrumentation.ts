/**
 * In-process scheduler — runs once when the Node.js server boots (Next.js calls
 * register() via the instrumentation hook). Railway runs a single persistent
 * `next start` process on the Hobby plan, so a timer here drives the recurring
 * jobs without any external cron wiring:
 *
 *   - reply detection (IMAP poll of the IONOS inbox) — hourly
 *   - follow-up sequence — once a day around 08:00 (server time)
 *
 * Deliberately uses only `setInterval` + global `fetch` — NO node-only packages
 * (node-cron, imapflow, nodemailer). Importing those here drags them into the
 * edge/instrumentation bundle and breaks the build. The actual work runs in the
 * Node.js runtime behind the secret-guarded /api/cron/maintenance route. Both
 * jobs are idempotent and also run in the nightly cron, so double-firing is safe.
 *
 * Set DISABLE_SCHEDULER=true to turn this off. Requires CRON_SECRET to be set.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_SCHEDULER === "true") return;
  if (!process.env.CRON_SECRET) {
    console.warn("[scheduler] CRON_SECRET not set — in-process scheduler disabled");
    return;
  }

  const port = process.env.PORT || "3000";
  const base = process.env.SELF_URL || `http://127.0.0.1:${port}`;

  const fire = async (job: "replies" | "followups") => {
    try {
      const res = await fetch(`${base}/api/cron/maintenance?job=${job}`, {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET! },
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[scheduler] ${job}:`, JSON.stringify(data).slice(0, 300));
    } catch (err) {
      console.error(`[scheduler] ${job} failed:`, (err as Error).message);
    }
  };

  const HOUR = 60 * 60 * 1000;
  let lastFollowUpDay = "";

  // One tick per hour: always poll replies; once per day around 08:00 also run
  // the follow-up sequence (guarded so it fires at most once that day).
  const tick = () => {
    void fire("replies");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === 8 && lastFollowUpDay !== today) {
      lastFollowUpDay = today;
      void fire("followups");
    }
  };

  // First poll shortly after boot, then hourly.
  setTimeout(tick, 30_000);
  setInterval(tick, HOUR);

  console.log("[scheduler] in-process scheduler started (replies hourly, follow-ups ~08:00)");
}
