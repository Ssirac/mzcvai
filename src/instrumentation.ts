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
  // Sentry is initialised lazily in @/lib/log (Node-only path) so @sentry/node
  // never gets pulled into the edge instrumentation bundle.
  if (process.env.DISABLE_SCHEDULER === "true") return;
  if (!process.env.CRON_SECRET) {
    console.warn("[scheduler] CRON_SECRET not set — in-process scheduler disabled");
    return;
  }

  const port = process.env.PORT || "3000";
  const base = process.env.SELF_URL || `http://127.0.0.1:${port}`;

  const fire = async (job: "replies" | "followups" | "refresh" | "cleanup" | "scrape" | "applyscan" | "digest") => {
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
  let tickCount = 0;

  // One tick per hour: always poll replies; every 4th tick refresh jobs from all
  // sources for the candidates' occupations (new vacancies land intraday); once
  // per day around 08:00 run the follow-up sequence.
  const tick = () => {
    void fire("replies");
    if (tickCount % 4 === 0) void fire("refresh");
    tickCount++;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === 8 && lastFollowUpDay !== today) {
      lastFollowUpDay = today;
      void fire("followups");
      void fire("digest"); // morning "what needs you today" summary email
    }
  };

  // First poll shortly after boot, then hourly.
  setTimeout(tick, 30_000);
  setInterval(tick, HOUR);

  // Frequent standalone purge of part-time / non-German / dead+expired listings
  // so candidates never see stale jobs — runs every CLEANUP_INTERVAL_MIN minutes
  // (default 30) on top of the per-ingest and hourly passes. No manual clicking.
  const cleanupMin = Math.max(5, parseInt(process.env.CLEANUP_INTERVAL_MIN ?? "30"));
  setTimeout(() => void fire("cleanup"), 45_000);
  setInterval(() => void fire("cleanup"), cleanupMin * 60 * 1000);

  // Script-based scraping cycle (Group A→C job boards) — runs continuously and
  // never stops, but on a spaced interval so it doesn't overload the box or the
  // source sites. Default every 3h (fresh enough for recruitment; ~3× lighter
  // than hourly). Disable with SCRAPE_ENABLED=false, or tune via
  // SCRAPE_INTERVAL_HOURS (e.g. "1" = hourly, "6" = every 6h). Overlapping runs
  // are skipped by an in-flight guard in runScrapeCycle, so a long cycle never
  // piles up on the next tick.
  if (process.env.SCRAPE_ENABLED !== "false") {
    const scrapeHours = Math.max(0.25, parseFloat(process.env.SCRAPE_INTERVAL_HOURS ?? "3"));
    setTimeout(() => void fire("scrape"), 90_000); // first run ~90s after boot
    setInterval(() => void fire("scrape"), scrapeHours * HOUR);
    console.log(`[scheduler] scraping cycle every ${scrapeHours}h`);
  }

  // Apply scanner — opt-in (drives a headless browser). Classifies form-apply
  // jobs and queues captcha/OTP/form items for human confirmation.
  if (process.env.APPLY_SCAN_ENABLED === "true") {
    const applyHours = Math.max(1, parseFloat(process.env.APPLY_SCAN_INTERVAL_HOURS ?? "6"));
    setTimeout(() => void fire("applyscan"), 120_000);
    setInterval(() => void fire("applyscan"), applyHours * HOUR);
    console.log(`[scheduler] apply scan every ${applyHours}h`);
  }

  console.log(`[scheduler] started (replies hourly, job refresh every 4h, cleanup every ${cleanupMin}m, follow-ups ~08:00)`);
}
