/**
 * In-memory rate limiter (per-process). Suitable for a single Node instance.
 * Used to throttle login attempts and other sensitive endpoints to make
 * brute-force and abuse infeasible.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodically drop expired buckets so the map doesn't grow unbounded.
let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  const expired: string[] = [];
  buckets.forEach((b, k) => { if (b.resetAt < now) expired.push(k); });
  expired.forEach((k) => buckets.delete(k));
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number; remaining: number } {
  sweep();
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }
  b.count++;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000), remaining: 0 };
  }
  return { ok: true, retryAfter: 0, remaining: limit - b.count };
}

// Clear a key (e.g. after a successful login)
export function rateLimitReset(key: string) {
  buckets.delete(key);
}

// Best-effort client IP from common proxy headers
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
