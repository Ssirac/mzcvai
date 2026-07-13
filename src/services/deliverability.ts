/**
 * Deliverability guard: automatically PAUSE automated sending when the recent
 * bounce rate gets dangerous, protecting the sending domain's reputation.
 *
 * Bounce rate = bounced / sent over the last BOUNCE_WINDOW_HOURS. Sending pauses
 * when the rate ≥ BOUNCE_PAUSE_RATE AND there is a meaningful sample
 * (≥ BOUNCE_PAUSE_MIN_SAMPLE). A manual kill switch (AUTO_SEND_PAUSED=true) also
 * forces a pause. Only AUTOMATED flows consult this; manual sends are unaffected.
 */

import { prisma } from "@/lib/prisma";

export interface BounceStats {
  sent: number;
  bounced: number;
  rate: number; // 0..1
  windowHours: number;
}

export async function bounceStats(): Promise<BounceStats> {
  const windowHours = parseInt(process.env.BOUNCE_WINDOW_HOURS ?? "48");
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const [sent, bounced] = await Promise.all([
    prisma.outreach.count({ where: { sentAt: { gte: since } } }),
    prisma.outreach.count({ where: { bouncedAt: { gte: since } } }),
  ]);
  return { sent, bounced, rate: sent > 0 ? bounced / sent : 0, windowHours };
}

export interface PauseState {
  paused: boolean;
  reason: string | null;
  stats: BounceStats;
}

// Whether automated sending should be paused right now.
export async function sendingPause(): Promise<PauseState> {
  const stats = await bounceStats();

  if (process.env.AUTO_SEND_PAUSED === "true") {
    return { paused: true, reason: "manual_kill_switch", stats };
  }

  const rateLimit = parseFloat(process.env.BOUNCE_PAUSE_RATE ?? "0.1"); // 10%
  const minSample = parseInt(process.env.BOUNCE_PAUSE_MIN_SAMPLE ?? "20");
  if (stats.sent >= minSample && stats.rate >= rateLimit) {
    return { paused: true, reason: `bounce_rate ${(stats.rate * 100).toFixed(1)}% ≥ ${(rateLimit * 100).toFixed(0)}%`, stats };
  }
  return { paused: false, reason: null, stats };
}

// Convenience boolean for gating automated send loops.
export async function isSendingPaused(): Promise<boolean> {
  return (await sendingPause()).paused;
}
