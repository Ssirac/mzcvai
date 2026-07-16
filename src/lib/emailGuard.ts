/**
 * GDPR send-guard — decides whether an email address is a PERSONAL address (a
 * named individual) that we must never cold-pitch, vs a generic company /
 * application inbox that is fine to contact. Pure functions, no dependencies, so
 * the send-time guard is unit-tested directly (see emailGuard.test.ts).
 */

// Local-parts that belong to a company boss/owner, not an application inbox.
// We never apply via these — a Geschäftsführer reacts badly to a cold pitch.
// Exact matches (avoid false positives like "chefkoch" = head chef = valid).
const EXEC_EXACT = new Set([
  "ceo", "cto", "cfo", "coo", "gf", "inhaber", "inhaberin", "owner", "vorstand",
  "direktor", "direktorin", "director", "boss", "praesident", "präsident", "president",
  "geschaeftsfuehrer", "geschäftsführer", "geschaeftsleitung", "geschäftsleitung",
]);
// Substrings that unambiguously mark an executive address.
const EXEC_CONTAINS = ["geschaeftsf", "geschäftsf", "geschaeftsleit", "geschäftsleit", "vorstand", "inhaber"];

export function isExecLocalpart(local: string): boolean {
  const l = local.toLowerCase().replace(/[.\-_0-9]/g, "");
  if (EXEC_EXACT.has(l)) return true;
  return EXEC_CONTAINS.some((t) => l.includes(t));
}

// Local parts that identify a DEPARTMENT / application inbox, not a person. A
// generic address often carries a branch or name suffix — e.g.
// bewerbung-felderer@, jobs-berlin@, hr-nord@, personal-hamburg@ — and is still
// a valid application address, so it must NOT be treated as personal.
const GENERIC_LOCAL_PREFIXES = new Set([
  "info", "bewerbung", "bewerbungen", "jobs", "job", "karriere", "career", "careers",
  "recruiting", "recruitment", "hr", "personal", "kontakt", "contact", "post", "mail",
  "office", "stelle", "stellen", "team", "service", "empfang", "zentrale", "verwaltung", "mailbox",
]);

export function looksPersonal(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  // Boss/owner address → never send (avoids annoying the Geschäftsführer).
  if (isExecLocalpart(local)) return true;
  // Department/application inbox with a suffix (bewerbung-felderer, jobs-berlin,
  // hr-nord) — the first token is a known generic prefix → treat as generic.
  const firstToken = local.split(/[.\-_]/)[0] ?? "";
  if (GENERIC_LOCAL_PREFIXES.has(firstToken)) return false;
  // Otherwise a firstname.lastname / f.lastname / firstname_lastname pattern is
  // a personal address — block it (GDPR default).
  return /^[a-z]+[.\-_][a-z]+$/i.test(local);
}
