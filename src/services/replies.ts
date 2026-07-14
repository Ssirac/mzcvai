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
import { outreachRef, parseRefTag } from "@/lib/outreachRef";

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

export interface ReconcileMove {
  employer: string | null;
  from: string; // candidate the reply was wrongly attached to
  to: string;   // candidate the reply actually belongs to
  via: "code" | "name";
  subject: string;
}
export interface ReconcileResult {
  applied: boolean;
  scanned: number;     // stored replies examined
  reassigned: number;  // replies moved to the correct candidate
  conflicts: number;   // correct owner already held its own reply — left untouched
  unmatched: number;   // couldn't identify a different owner — left as-is
  moves: ReconcileMove[];
}

/**
 * One-off repair for replies that were attached to the wrong candidate before
 * the subject-code / name matching existed. Works purely on data already stored
 * in the DB (no IMAP): for every outreach that holds a stored reply, it finds
 * the true owner among the outreaches to the same employer — by the subject
 * reference code first, then by the candidate name appearing in the reply — and,
 * when that owner differs, moves the reply onto it and resets the wrongly-tagged
 * outreach back to SENT.
 *
 * Dry-run by default: pass apply=true to write. A reply is never moved onto an
 * outreach that already holds its own distinct reply (reported as a conflict for
 * manual review), so nothing real is ever clobbered.
 */
export async function reconcileReplies(apply = false): Promise<ReconcileResult> {
  const result: ReconcileResult = { applied: apply, scanned: 0, reassigned: 0, conflicts: 0, unmatched: 0, moves: [] };

  const replied = await prisma.outreach.findMany({
    where: { status: "REPLIED", replySubject: { not: null } },
    select: {
      id: true, matchId: true, repliedAt: true, replyFrom: true, replySubject: true, replyText: true,
      match: { select: { employerId: true, employer: { select: { name: true } }, candidate: { select: { name: true } } } },
    },
  });
  if (replied.length === 0) return result;

  const employerIds = Array.from(new Set(replied.map((r) => r.match?.employerId).filter(Boolean) as string[]));
  const siblings = await prisma.outreach.findMany({
    where: { match: { employerId: { in: employerIds } } },
    select: {
      id: true, matchId: true, status: true, replySubject: true,
      match: { select: { employerId: true, candidate: { select: { name: true } } } },
    },
  });
  const byEmployer = new Map<string, typeof siblings>();
  for (const s of siblings) {
    const e = s.match?.employerId;
    if (e) (byEmployer.get(e) ?? byEmployer.set(e, []).get(e)!).push(s);
  }

  for (const o of replied) {
    result.scanned++;
    const employerId = o.match?.employerId;
    if (!employerId) { result.unmatched++; continue; }
    const group = byEmployer.get(employerId) ?? [];
    const hay = `${o.replySubject ?? ""} ${o.replyText ?? ""}`.toLowerCase();

    const ref = parseRefTag(o.replySubject);
    const owner =
      (ref ? group.find((s) => outreachRef(s.id) === ref) : undefined) ||
      group.find((s) => {
        const nm = s.match?.candidate?.name?.toLowerCase();
        return nm && nm.length > 2 && hay.includes(nm);
      });

    if (!owner) { result.unmatched++; continue; }   // can't tell — leave as is
    if (owner.id === o.id) continue;                 // already correct
    if (owner.status === "REPLIED" && owner.replySubject) { result.conflicts++; continue; }

    result.reassigned++;
    result.moves.push({
      employer: o.match?.employer?.name ?? null,
      from: o.match?.candidate?.name ?? o.id,
      to: owner.match?.candidate?.name ?? owner.id,
      via: ref && group.find((s) => outreachRef(s.id) === ref) ? "code" : "name",
      subject: (o.replySubject ?? "").slice(0, 120),
    });

    if (apply) {
      // Move the reply onto the correct outreach…
      await prisma.outreach.update({
        where: { id: owner.id },
        data: { status: "REPLIED", repliedAt: o.repliedAt, replyFrom: o.replyFrom, replySubject: o.replySubject, replyText: o.replyText },
      });
      await prisma.match.update({ where: { id: owner.matchId }, data: { status: "REPLIED" } }).catch(() => {});
      // …and reset the wrongly-attributed one back to just-sent (it never
      // actually received a reply, so it can still get follow-ups and its own).
      await prisma.outreach.update({
        where: { id: o.id },
        data: { status: "SENT", repliedAt: null, replyFrom: null, replySubject: null, replyText: null },
      });
      await prisma.match.update({ where: { id: o.matchId }, data: { status: "SENT" } }).catch(() => {});
      // Keep the in-memory group consistent for the rest of this run.
      owner.status = "REPLIED"; owner.replySubject = o.replySubject;
    }
  }
  return result;
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

        // 1) Unambiguous: match the unique reference code carried in the subject
        //    ("… [MZ-1A2B3C4]"). This is exact even when several candidates — or
        //    two same-named candidates — were mailed to the same company.
        const replyRef = parseRefTag(subject);
        // 2) Fallback for older emails sent before the code existed: our subject
        //    was "Bewerbung als <title> – <candidate name>", so the reply names
        //    the candidate. 3) Last resort: the first open thread on the domain.
        const subjLc = subject.toLowerCase();
        const target =
          (replyRef && eligible.find((o) => outreachRef(o.id) === replyRef)) ||
          eligible.find((o) => {
            const nm = o.match?.candidate?.name?.toLowerCase();
            return nm && nm.length > 2 && subjLc.includes(nm);
          }) ||
          eligible[0];

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
