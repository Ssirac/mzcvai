/**
 * "Actionable" vacancy gate — quality over quantity.
 *
 * The client's point: the pipeline surfaces lots of listings, but many can't
 * actually be applied to — no email, no usable form, or the apply link points to
 * a site we can't reach (StepStone, LinkedIn, Indeed…). Better to keep 5 REAL
 * jobs a candidate can apply to than 50 dead ends.
 *
 * A vacancy is actionable when it offers a real apply path:
 *   • a valid company email (email application), OR
 *   • a form/apply URL on a host we can actually open and fill.
 * Everything else is dropped from matching and from the candidate's view.
 */

// Hosts we cannot bot-apply to (hard bot-walls / login-gated / no fillable form).
// A FORM apply pointing at any of these is a dead end — drop it.
const BLOCKED_APPLY_HOSTS = [
  "stepstone", "indeed", "linkedin", "xing", "monster", "glassdoor",
  "meinestadt", "kimeta", "stellenwerk", "jobrapido", "jobbörse.de",
  "kununu", "gehalt.de", "google.com/search",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function validEmail(s: string | null | undefined): boolean {
  return !!s && EMAIL_RE.test(s.trim());
}

export interface ActionableInput {
  applyChannel: string | null;        // "EMAIL" | "FORM"
  applyValue: string | null;          // email or url, depending on channel
  url: string | null;                 // listing/apply url
  employerEmail: string | null;       // employer.genericEmail
}

export interface ActionableResult { actionable: boolean; reason: string }

export function isActionable(v: ActionableInput): ActionableResult {
  // 1) A real email anywhere ⇒ we can send an application.
  const emailCandidate =
    (v.applyChannel === "EMAIL" ? v.applyValue : null) || v.employerEmail;
  if (validEmail(emailCandidate)) return { actionable: true, reason: "email" };

  // 2) A form/apply URL we can actually reach (not a blocked host).
  const url = (v.applyChannel === "FORM" ? v.applyValue : null) || v.url;
  const host = hostOf(url);
  if (host) {
    if (BLOCKED_APPLY_HOSTS.some((b) => host.includes(b))) {
      return { actionable: false, reason: `blocked host (${host})` };
    }
    return { actionable: true, reason: "form" };
  }

  // 3) No email, no reachable URL ⇒ nothing to do with it.
  return { actionable: false, reason: "no apply channel" };
}

export const BLOCKED_HOSTS = BLOCKED_APPLY_HOSTS;
