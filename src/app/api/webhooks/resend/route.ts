import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/webhooks/resend
// Receives Resend delivery events (delivered / opened / clicked / bounced /
// complained) and updates the matching Outreach row by its providerId (the
// Resend message id stored at send time). This powers open-tracking and bounce
// detection in the pipeline without any polling.
//
// Guarded by a shared secret: configure RESEND_WEBHOOK_SECRET in Railway and add
// it to the webhook URL in the Resend dashboard, e.g.
//   https://<app>/api/webhooks/resend?secret=<RESEND_WEBHOOK_SECRET>
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const type = event.type ?? "";
  const emailId = event.data?.email_id;
  if (!emailId) return NextResponse.json({ ok: true, skipped: "no email_id" });

  const outreach = await prisma.outreach.findFirst({
    where: { providerId: emailId },
    select: { id: true, status: true },
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
    case "email.complained":
      await prisma.outreach.update({
        where: { id: outreach.id },
        data: { bouncedAt: now, status: "BOUNCED" },
      });
      break;

    default:
      // sent / clicked / scheduled etc. — nothing to persist for now
      break;
  }

  return NextResponse.json({ ok: true });
}
