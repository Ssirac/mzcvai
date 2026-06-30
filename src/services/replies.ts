/**
 * Reply detection — polls the IONOS inbox over IMAP and marks the matching
 * Outreach (and its Match) as REPLIED when an employer answers an application.
 *
 * Why IMAP: replies go to the reply-to / from address, which is the IONOS
 * mailbox the agency watches. Reading it back lets the pipeline show which
 * employers responded and stops the follow-up sequence for those threads.
 *
 * Credentials reuse the existing IONOS mailbox login already configured for
 * sending (IMAP_USER/IMAP_PASS, falling back to SMTP_USER/SMTP_PASS). Nothing
 * new to share — the user sets these in Railway, the app never exposes them.
 *
 * Fail-soft: if IMAP egress is blocked or login fails, this logs and returns 0
 * so the rest of the system is unaffected.
 */

import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.toLowerCase().split("@")[1];
  return at ? at.replace(/^www\./, "") : null;
}

export interface ReplyPollResult {
  scanned: number;
  matched: number;
  errors: string[];
}

export async function pollReplies(sinceDays = 5): Promise<ReplyPollResult> {
  const result: ReplyPollResult = { scanned: 0, matched: 0, errors: [] };

  const host = process.env.IMAP_HOST || "imap.ionos.de";
  const port = parseInt(process.env.IMAP_PORT || "993");
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  if (!user || !pass) {
    result.errors.push("IMAP credentials not configured (IMAP_USER/IMAP_PASS or SMTP_USER/SMTP_PASS)");
    return result;
  }

  // Candidate outreach to match replies against: sent, not yet replied/bounced.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const open = await prisma.outreach.findMany({
    where: {
      status: { in: ["SENT", "OPENED"] },
      sentAt: { gte: cutoff, not: null },
      toAddress: { not: null },
    },
    select: { id: true, toAddress: true, sentAt: true, matchId: true },
    orderBy: { sentAt: "desc" },
  });

  // Index by recipient domain (employers often reply from a personal address on
  // the same domain, e.g. we mail info@hotel.de, a person replies from
  // max@hotel.de), with an exact-address fast path too.
  const byDomain = new Map<string, typeof open>();
  const byAddress = new Map<string, typeof open>();
  for (const o of open) {
    const d = domainOf(o.toAddress);
    if (d) (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(o);
    const a = o.toAddress!.toLowerCase();
    (byAddress.get(a) ?? byAddress.set(a, []).get(a)!).push(o);
  }

  const client = new ImapFlow({
    host, port, secure: port === 993,
    auth: { user, pass },
    logger: false,
    socketTimeout: 20000,
  });

  try {
    await client.connect();
  } catch (err) {
    result.errors.push(`IMAP connect failed: ${(err as Error).message}`);
    return result;
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return result;

      for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
        result.scanned++;
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const subject = msg.envelope?.subject ?? "";
        const msgDate = msg.envelope?.date ?? new Date();
        if (!fromAddr) continue;

        // Find a still-open outreach this reply belongs to: exact address first,
        // then same-domain; only ones sent before the reply arrived.
        const candidates =
          byAddress.get(fromAddr) ?? byDomain.get(domainOf(fromAddr) ?? "") ?? [];
        const target = candidates.find((o) => o.sentAt && o.sentAt <= msgDate);
        if (!target) continue;

        await prisma.outreach.update({
          where: { id: target.id },
          data: {
            status: "REPLIED",
            repliedAt: msgDate,
            replyText: subject.slice(0, 500),
          },
        });
        await prisma.match.update({
          where: { id: target.matchId },
          data: { status: "REPLIED" },
        }).catch(() => {});

        // Don't match the same outreach twice in this run
        const idx = candidates.indexOf(target);
        if (idx !== -1) candidates.splice(idx, 1);
        result.matched++;
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    result.errors.push(`IMAP read failed: ${(err as Error).message}`);
  } finally {
    await client.logout().catch(() => {});
  }

  return result;
}
