/**
 * Employer name + domain normalization, shared by de-duplication. Pure and
 * unit-tested — no DB access here.
 */

// Strip legal-form suffixes and punctuation so "Hotel Adler GmbH & Co. KG" and
// "hotel adler" collapse to the same key.
export function normalizeEmployerName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|ohg|mbh|ug|e\.?\s?v\.?|kgaa|co\.?|se|gbr|partg|mbb|&|\+)\b/g, " ")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Free / webmail hosts that are NEVER a company's own domain — must not be used
// as a dedup signal (many unrelated employers share gmail.com etc.).
export const FREE_MAIL_HOSTS = new Set([
  "gmail.com", "googlemail.com", "gmx.de", "gmx.net", "web.de", "t-online.de",
  "outlook.com", "hotmail.com", "hotmail.de", "yahoo.com", "yahoo.de",
  "icloud.com", "aol.com", "freenet.de", "mail.de", "posteo.de",
]);

// Extract a normalized registrable-ish domain (lowercase, no www) from a URL or
// a bare domain string. Returns null if none can be parsed or it's a free host.
export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  let host: string | null = null;
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    host = u.hostname.toLowerCase();
  } catch {
    const m = String(website).toLowerCase().match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
    host = m ? m[1] : null;
  }
  if (!host) return null;
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || FREE_MAIL_HOSTS.has(host)) return null;
  return host;
}

// The domain of an email address, normalized the same way (null for free hosts).
export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.toLowerCase().split("@")[1];
  return at && at.includes(".") && !FREE_MAIL_HOSTS.has(at) ? at : null;
}

// Normalize a job title into a comparison token: drop gender markers (m/w/d),
// punctuation and case so "Koch (m/w/d)" and "Koch / Köchin" collapse to the
// same key. Shared by cross-source de-dup and feedback suppression.
export function normalizeJobTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/\(\s*[mwdfx](\s*\/\s*[mwdfx])*\s*\)/g, " ") // (m/w/d), (w/m/d), (m/w/d/x)
    .replace(/\bm\s*\/\s*w\s*\/\s*d\b/g, " ")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
