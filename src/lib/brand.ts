/**
 * Company/brand name shown to employers — the single source of truth.
 *
 * Deliberately hardcoded (not env-driven) so it reliably reflects the brand
 * regardless of any stale AGENCY_NAME / MAIL_FROM display name set in the deploy
 * environment. Only the DISPLAYED company name is "MZ Talent Solutions"; the
 * sending address and website are configured separately and stay unchanged
 * (info@mz-personalvermittlung.de / mz-personalvermittlung.de).
 */
export const AGENCY_NAME = "MZ Talent Solutions";

/**
 * Build a From header that always uses the brand as the display name while
 * keeping whatever address is configured. Accepts either a bare address
 * ("info@x.de") or an already-formatted header ("Old Name <info@x.de>") and
 * returns `MZ Talent Solutions <info@x.de>`.
 */
export function brandedFrom(configured: string | undefined, fallbackAddress: string): string {
  const source = (configured ?? "").trim();
  const match = source.match(/<([^>]+)>/);
  const address = (match ? match[1] : source || fallbackAddress).trim();
  return `${AGENCY_NAME} <${address}>`;
}
