import { NextRequest, NextResponse } from "next/server";
import { createToken, checkCredentials, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";

// Brute-force protection: max 8 attempts per IP per 15 minutes.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const key = `login:${ip}`;

  const rl = rateLimit(key, MAX_ATTEMPTS, WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    if (!checkCredentials(username, password)) {
      // Small fixed delay slows automated guessing further
      await sleep(400);
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }

    // Success — clear the attempt counter for this IP
    rateLimitReset(key);

    const token = await createToken(username);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
