/**
 * Per-outreach reference code carried in the email subject.
 *
 * Why: matching an employer's reply back to the right candidate must not rely on
 * the company domain (several candidates can be mailed to the same company) or
 * the candidate's name (two candidates could share a name). A unique code is the
 * only unambiguous key. German employers reply with "AW: <original subject>", so
 * a code placed in the subject survives into the reply and identifies the exact
 * outreach.
 *
 * The code is derived deterministically from the outreach id (a unique cuid), so
 * no database column is needed and the same id always yields the same code —
 * meaning the reply poller can recompute each open outreach's code and match it
 * against the code parsed from the reply subject.
 */
import crypto from "crypto";

const TAG = "MZ";
// e.g. [MZ-1A2B3C4] — 7 hex chars = ~268M values, collisions are negligible.
const RE = new RegExp(`\\[${TAG}-([0-9A-F]{7})\\]`, "i");

/** Short, stable reference code for an outreach id. */
export function outreachRef(id: string): string {
  return crypto.createHash("sha1").update(id).digest("hex").slice(0, 7).toUpperCase();
}

/** Append the code tag to a subject, unless it's already present. */
export function withRefTag(subject: string, id: string): string {
  if (RE.test(subject)) return subject;
  return `${subject} [${TAG}-${outreachRef(id)}]`;
}

/** Extract the reference code from a (reply) subject, or null if absent. */
export function parseRefTag(subject: string | null | undefined): string | null {
  const m = subject ? subject.match(RE) : null;
  return m ? m[1].toUpperCase() : null;
}
