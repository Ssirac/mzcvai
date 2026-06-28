import { NextResponse } from "next/server";

/**
 * Return a JSON error response without leaking internal details in production.
 * Full error is logged server-side; the client gets a generic message.
 */
export function apiError(err: unknown, status = 500, publicMessage = "Internal error") {
  console.error("[api]", err);
  const message = (err as Error).message || publicMessage;
  return NextResponse.json({ error: message }, { status });
}
