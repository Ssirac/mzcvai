/**
 * Content hashing for cross-source de-duplication. The SAME job is often posted
 * on several boards (e.g. Hotelcareer + Gastrojobs) with different URLs, so a
 * URL-only key can't catch it. We hash the stable essence of a posting — title +
 * employer + location — and skip storing a second row whose hash we already have.
 */

import { createHash } from "crypto";

// Normalize a field for hashing: lowercase, strip accents/punctuation, collapse
// whitespace — so "Koch (m/w/d)" and "koch m w d" hash identically.
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining accents
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function contentHash(parts: { title: string; employer: string; location?: string | null }): string {
  const basis = [norm(parts.title), norm(parts.employer), norm(parts.location)].join("|");
  return createHash("sha256").update(basis).digest("hex");
}
