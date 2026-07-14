/**
 * Role-based access control — the single source of truth for who may do what.
 *
 * The actor's role is derived server-side from the authenticated session
 * (getSessionUser → roleFor); the client never supplies a role or identity.
 * Today the sole login resolves to ADMIN (roleFor default), so gating the
 * ADMIN-only actions changes nothing for the current user — it's the foundation
 * that stays correct once a RECRUITER role is introduced via ROLE_MAP.
 */

import { NextResponse } from "next/server";
import { getSessionUser, roleFor } from "@/lib/auth";

export type Role = "ADMIN" | "RECRUITER";

// Every guarded capability. Keep this the ONLY place the matrix is defined.
export type Action =
  | "settings.read" | "settings.write"
  | "candidate.read" | "candidate.write" | "candidate.delete"
  | "gdpr"                       // GDPR export / delete
  | "outreach.draft" | "outreach.send" | "outreach.bulk"
  | "admin.maintenance";        // destructive/bulk admin ops (rematch, sweep, reconcile, queue cleanup)

// Permission matrix. ADMIN may do everything; RECRUITER is the restricted set.
const RECRUITER_ALLOWED: ReadonlySet<Action> = new Set<Action>([
  "candidate.read", "candidate.write",
  "outreach.draft", "outreach.send",
]);

/** Pure check — does this role have this permission? */
export function can(role: Role, action: Action): boolean {
  if (role === "ADMIN") return true;
  return RECRUITER_ALLOWED.has(action);
}

export interface AuthzOk { ok: true; actor: string | null; role: Role }
export interface AuthzDeny { ok: false; response: NextResponse }

/**
 * Resolve the actor+role from the session and check `action`. On deny returns a
 * 403 in the app's `{ error }` shape (no info leak). Usage:
 *   const authz = await authorize(req, "gdpr");
 *   if (!authz.ok) return authz.response;
 *   const { actor } = authz;
 */
export async function authorize(
  req: { cookies: { get(name: string): { value: string } | undefined } },
  action: Action,
): Promise<AuthzOk | AuthzDeny> {
  const actor = await getSessionUser(req);
  const role = roleFor(actor);
  if (!can(role, action)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, actor, role };
}
