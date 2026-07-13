/**
 * Lightweight signed-session auth (no external deps, Edge + Node compatible).
 *
 * A session token is `base64url(payload).base64url(HMAC-SHA256(payload))`.
 * The HMAC key is NEXTAUTH_SECRET. Tokens carry an expiry and are verified in
 * middleware on every request. This protects all pages and API routes behind a
 * single shared admin login — appropriate for an internal recruiting console.
 */

const COOKIE_NAME = "mz_session";
const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production";
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

// Constant-time-ish string compare
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createToken(username: string, ttlMs = SESSION_TTL_MS): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ u: username, exp: Date.now() + ttlMs })));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(token: string | undefined | null): Promise<{ u: string } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { u: String(data.u) };
  } catch {
    return null;
  }
}

// Resolve the logged-in username from a request's session cookie. Used by
// mutating API routes to record WHO performed an action (audit trail) instead of
// a hardcoded placeholder. Returns null if unauthenticated (middleware already
// blocks that, so this is defence-in-depth).
export async function getSessionUser(
  req: { cookies: { get(name: string): { value: string } | undefined } }
): Promise<string | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const s = await verifyToken(token);
  return s?.u ?? null;
}

// Resolve a username → role. Foundation for RBAC on top of the single-admin
// login: an optional ROLE_MAP env (JSON {"user":"RECRUITER"}) overrides the
// DEFAULT_ROLE. Today there is effectively one admin; this gives a single source
// of truth to grow into a real user store.
export function roleFor(username: string | null): "ADMIN" | "RECRUITER" {
  let mapped: string | undefined;
  try {
    const map = process.env.ROLE_MAP ? (JSON.parse(process.env.ROLE_MAP) as Record<string, string>) : {};
    if (username) mapped = map[username];
  } catch { /* invalid ROLE_MAP → ignore */ }
  const role = mapped || process.env.DEFAULT_ROLE || "ADMIN";
  return role === "RECRUITER" ? "RECRUITER" : "ADMIN";
}

// Verify provided credentials against env-configured admin account
export function checkCredentials(username: string, password: string): boolean {
  const u = process.env.ADMIN_USER || "admin";
  const p = process.env.ADMIN_PASSWORD || "";
  if (!p) return false; // no password configured = login disabled
  return safeEqual(username, u) && safeEqual(password, p);
}
