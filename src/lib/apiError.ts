import { NextResponse } from "next/server";
import { log } from "@/lib/log";

/**
 * Return a JSON error response without leaking internal details in production.
 * The full error is logged server-side (and forwarded to Sentry when SENTRY_DSN
 * is set, via log.error); the client gets a generic message unless an explicit
 * `publicMessage` is provided (used for intentional 4xx validation errors).
 *
 * Pass a specific status + publicMessage for expected client errors, e.g.
 *   apiError(err, 400, "Invalid input")
 * For unexpected 500s, call apiError(err) — the raw message is never exposed.
 */
export function apiError(err: unknown, status = 500, publicMessage?: string) {
  const detail = err instanceof Error ? err.message : String(err);
  log.error("api_error", { status, detail });

  // Reveal the raw message only in dev, or for explicit 4xx with a publicMessage.
  const isClientError = status >= 400 && status < 500;
  const exposeRaw = process.env.NODE_ENV !== "production" || (isClientError && !!publicMessage);
  const message = publicMessage ?? (exposeRaw ? detail : "Internal error");
  return NextResponse.json({ error: message }, { status });
}
