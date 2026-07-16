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
