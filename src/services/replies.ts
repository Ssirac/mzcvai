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
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.toLowerCase().split("@")[1];
  return at ? at.replace(/^www\./, "") : null;
}

// An employer telling us to stop. If the reply says any of these, we flag the
// employer as opted-out so no further application or follow-up is ever sent.
const OPT_OUT_PHRASES = [
  "aus dem verteiler", "aus ihrem verteiler", "aus eurem verteiler", "löschen sie uns", "loeschen sie uns",
  "keine weiteren nachrichten", "keine weiteren e-mails", "keine weiteren mails", "keine weiteren angebote",
  "keine vorschläge", "keine vorschlaege", "keine externe unterstützung", "keine externe unterstuetzung",
  "kein interesse", "nicht kontaktieren", "nicht mehr kontaktieren", "bitte abmelden", "abmelden",
  "unsubscribe", "remove us", "stop sending", "do not contact", "keine zusammenarbeit",
  "wir benötigen keine", "wir benoetigen keine", "no thanks", "kein bedarf", "keinen bedarf",
  // "please refrain from further emails" — common formal phrasings that don't
  // use "keine" (this is what expertum GmbH used and it slipped through).
  "abzusehen", "von weiteren e-mails absehen", "von weiteren mails absehen",
  "von weiteren zusendungen", "keine weiteren zusendungen", "keine e-mails mehr",
  "keine mails mehr", "keine werbung", "werbung untersagt", "bitten wir sie, von",
  "bitten sie, von", "verweisen nochmals", "widersprechen der nutzung",
  // Wrong-target notices ("we don't operate a restaurant", "wrong address") —
  // the listing was misattributed to this company; never contact them again.
  "betreiben kein", "betreiben keine", "falsche adresse", "falscher empfänger", "falscher empfaenger",
  "nicht der richtige ansprechpartner", "sind kein restaurant", "sind kein hotel", "verwechslung",
];
function isOptOutReply(text: string): boolean {
  const t = text.toLowerCase();
  return OPT_OUT_PHRASES.some((p) => t.includes(p));
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
    select: { id: true, toAddress: true, sentAt: true, matchId: true, match: { select: { employerId: true, candidate: { select: { name: true } } } } },
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

  // Map every contacted employer's domain → employerId (ANY outreach status), so
  // an opt-out reply can flag the employer even if that thread was already
  // marked REPLIED on an earlier poll.
  const contacted = await prisma.outreach.findMany({
    where: { sentAt: { gte: cutoff, not: null }, toAddress: { not: null } },
    select: { toAddress: true, match: { select: { employerId: true } } },
  });
  const employerByDomain = new Map<string, string>();
  for (const c of contacted) {
    const d = domainOf(c.toAddress);
    if (d && c.match?.employerId && !employerByDomain.has(d)) employerByDomain.set(d, c.match.employerId);
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

      for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
        result.scanned++;
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const fromName = msg.envelope?.from?.[0]?.name ?? "";
        const subject = msg.envelope?.subject ?? "";
        const msgDate = msg.envelope?.date ?? new Date();
        if (!fromAddr) continue;

        const senderDomain = domainOf(fromAddr) ?? "";

        // Find a still-open outreach this reply belongs to: exact address first,
        // then same-domain; only ones sent before the reply arrived.
        const candidates =
          byAddress.get(fromAddr) ?? byDomain.get(senderDomain) ?? [];
        const eligible = candidates.filter((o) => o.sentAt && o.sentAt <= msgDate);
        // When several candidates were mailed to the same company, the domain
        // alone can't tell them apart. Our sent subject is
        // "Bewerbung als <title> – <candidate name>", so the reply subject
        // ("AW: … – <candidate name>") names the exact candidate. Prefer the
        // outreach whose candidate name appears in the reply subject; only fall
        // back to the first open thread when no name matches (e.g. auto-reply
        // that stripped the subject).
        const subjLc = subject.toLowerCase();
        const target =
          eligible.find((o) => {
            const nm = o.match?.candidate?.name?.toLowerCase();
            return nm && nm.length > 2 && subjLc.includes(nm);
          }) ?? eligible[0];

        // Parse the full message body (needed both for the inbox text and for
        // opt-out phrase detection, including on already-replied threads).
        let body = "";
        try {
          if (msg.source) {
            const parsed = await simpleParser(msg.source);
            body = (parsed.text || parsed.subject || "").trim();
          }
        } catch { /* keep body empty */ }

        // Opt-out detection works even when there's no open target (e.g. the
        // thread was already marked REPLIED): flag the employer by sender domain.
        if (isOptOutReply(`${subject} ${body}`)) {
          const empId = target?.match?.employerId ?? employerByDomain.get(senderDomain);
          if (empId) {
            await prisma.employer.update({ where: { id: empId }, data: { optedOut: true } }).catch(() => {});
          }
        }

        if (!target) continue;

        const replyStored = `${subject}\n\n${body}`.trim().slice(0, 4000);

        await prisma.outreach.update({
          where: { id: target.id },
          data: {
            status: "REPLIED",
            repliedAt: msgDate,
            replyFrom: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
            replySubject: subject.slice(0, 300),
            replyText: replyStored,
          },
        });
        await prisma.match.update({
          where: { id: target.matchId },
          data: { status: "REPLIED" },
        }).catch(() => {});
        // (opt-out already handled above, before the target check)

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
