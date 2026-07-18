import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Constant-time string comparison — a plain !== leaks length/prefix timing.
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Verify Resend's signed webhook (svix format): signature = HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>" keyed with the base64 part of the
// "whsec_…" signing secret. Rejects stale timestamps (>5 min) to stop replays.
function verifySvixSignature(req: NextRequest, rawBody: string, signingSecret: string): boolean {
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(signingSecret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  // Header may carry several space-separated "v1,<sig>" entries.
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1];
    return !!sig && safeEq(sig, expected);
  });
}

// POST /api/webhooks/resend
// Receives Resend delivery events (delivered / opened / clicked / bounced /
// complained) and updates the matching Outreach row by its providerId (the
// Resend message id stored at send time). This powers open-tracking and bounce
// detection in the pipeline without any polling.
//
// Auth, strongest first:
//   1. RESEND_WEBHOOK_SIGNING_SECRET ("whsec_…" from the Resend dashboard) —
//      full signature verification of the raw body; the query secret is then
//      not needed at all.
//   2. Fallback: RESEND_WEBHOOK_SECRET as ?secret=<…> in the webhook URL
//      (legacy setup; keeps existing deployments working).
export async function POST(req: NextRequest) {
  // FAIL CLOSED: without a configured secret this endpoint must reject — a
  // spoofed "bounced" event could otherwise trip the deliverability kill switch
  // and silently stop all sending (denial of service via fake webhooks).
  const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  const querySecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!signingSecret && !querySecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const rawBody = await req.text();

  if (signingSecret) {
    if (!verifySvixSignature(req, rawBody, signingSecret)) {
      return NextResponse.json({ error: "Bad signature" }, { status: 401 });
    }
  } else {
    const provided = req.nextUrl.searchParams.get("secret");
    if (!provided || !safeEq(provided, querySecret!)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const type = event.type ?? "";
  const emailId = event.data?.email_id;
  if (!emailId) return NextResponse.json({ ok: true, skipped: "no email_id" });

  const outreach = await prisma.outreach.findFirst({
    where: { providerId: emailId },
    select: {
      id: true, status: true, toAddress: true,
      match: { select: { employerId: true } },
    },
  });
  if (!outreach) return NextResponse.json({ ok: true, skipped: "unknown email_id" });

  const now = new Date();

  switch (type) {
    case "email.delivered":
      await prisma.outreach.update({
        where: { id: outreach.id },
        data: { deliveredAt: now },
      });
      break;

    case "email.opened":
      await prisma.outreach.update({
        where: { id: outreach.id },
        data: {
          openedAt: now, // last open; first open is whenever this first fires
          openCount: { increment: 1 },
          // Don't downgrade a REPLIED record back to OPENED
          ...(outreach.status === "SENT" ? { status: "OPENED" } : {}),
        },
      });
      break;

    case "email.bounced":
    case "email.complained": {
      await prisma.outreach.update({
        where: { id: outreach.id },
        data: { bouncedAt: now, status: "BOUNCED" },
      });
      // Recover the lost employer: remember the bad address, clear it, and let
      // re-enrichment (matches load / nightly) find an alternative that isn't on
      // the bounced list. Only on hard bounce, not spam complaint.
      const bad = outreach.toAddress?.toLowerCase();
      const employerId = outreach.match?.employerId;
      if (type === "email.bounced" && bad && employerId) {
        const emp = await prisma.employer.findUnique({
          where: { id: employerId },
          select: { genericEmail: true, bouncedEmails: true },
        });
        if (emp) {
          const bouncedEmails = Array.from(new Set([...(emp.bouncedEmails ?? []), bad]));
          await prisma.employer.update({
            where: { id: employerId },
            data: {
              bouncedEmails,
              // Drop the dead address so the employer re-qualifies for enrichment
              ...(emp.genericEmail?.toLowerCase() === bad
                ? { genericEmail: null, emailStatus: "undeliverable", emailSource: null }
                : {}),
              lastEnrichedAt: null,
            },
          });
        }
      }
      break;
    }

    default:
      // sent / clicked / scheduled etc. — nothing to persist for now
      break;
  }

  return NextResponse.json({ ok: true });
}
