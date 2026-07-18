/**
 * SSRF guard for URLs the app actively visits (headless-browser scans, dead-
 * listing checks). Vacancy URLs come from external job feeds — a malicious or
 * corrupted listing must never make our server request internal targets
 * (localhost, private ranges, cloud metadata, *.internal).
 */

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,               // e.g. railway.internal service mesh
  /^127\./, /^0\./,             // loopback / this-host
  /^10\./,                      // RFC1918
  /^192\.168\./,                // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16–31
  /^169\.254\./,                // link-local + cloud metadata (169.254.169.254)
  /^\[?::1\]?$/,                // IPv6 loopback
  /^\[?f[cd][0-9a-f]{2}:/i,     // IPv6 unique-local fc00::/7
  /^\[?fe80:/i,                 // IPv6 link-local
];

/** True when the URL is http(s) to a public, non-internal host. */
export function isSafeExternalUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (!host) return false;
  return !PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

// ── DNS-level check (Node runtime only) ──────────────────────────────────────
// The syntactic check above can't catch a PUBLIC hostname that RESOLVES to a
// private address (attacker-controlled DNS / rebinding-style records). Before
// actively visiting a URL (fetch, headless browser), resolve the host and
// verify every A/AAAA answer is public.

function isPrivateIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").toLowerCase().replace(/^::ffff:/, "");
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a === 127 || a === 10 || a === 0) return true;      // loopback / RFC1918 / this-host
    if (a === 192 && b === 168) return true;                // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;       // RFC1918
    if (a === 169 && b === 254) return true;                // link-local + cloud metadata
    if (a >= 224) return true;                              // multicast / reserved
    return false;
  }
  if (ip === "::1" || ip === "::") return true;             // v6 loopback / unspecified
  if (/^f[cd]/.test(ip)) return true;                       // unique-local fc00::/7
  if (/^fe[89ab]/.test(ip)) return true;                    // link-local fe80::/10
  return false;
}

export type TargetSafety = "safe" | "unsafe" | "unresolvable";

/**
 * Full safety check for a URL the server is about to VISIT: syntactic guard
 * first, then DNS resolution — every resolved address must be public.
 * "unresolvable" is reported separately so callers can treat a DNS hiccup as
 * inconclusive (e.g. don't delete a listing over our own resolver trouble).
 */
export async function classifyExternalTarget(raw: string | null | undefined): Promise<TargetSafety> {
  if (!isSafeExternalUrl(raw)) return "unsafe";
  const host = new URL(raw!).hostname.replace(/^\[|\]$/g, "");
  // Literal IP — no DNS needed.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    return isPrivateIp(host) ? "unsafe" : "safe";
  }
  try {
    const { lookup } = await import("dns/promises"); // Node-only; lazy so the module stays edge-importable
    const addrs = await lookup(host, { all: true, verbatim: true });
    if (!addrs.length) return "unresolvable";
    return addrs.some((a) => isPrivateIp(a.address)) ? "unsafe" : "safe";
  } catch {
    return "unresolvable";
  }
}

/** Convenience boolean: strictly safe to visit (unsafe AND unresolvable ⇒ false). */
export async function isSafeExternalTarget(raw: string | null | undefined): Promise<boolean> {
  return (await classifyExternalTarget(raw)) === "safe";
}
