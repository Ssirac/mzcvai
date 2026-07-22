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

import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import { outreachRef, parseRefTag } from "@/lib/outreachRef";
import { classifyReply } from "@/services/replyClassifier";
import { notifyImportantReply } from "@/services/replyNotify";

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.toLowerCase().split("@")[1];
  return at ? at.replace(/^www\./, "") : null;
}

// Mailboxes to scan for employer replies: always INBOX, plus any Junk/Spam
// folder. IONOS (and most providers) file some legitimate employer answers into
// Spam; polling INBOX alone meant those replies stayed invisible forever — no
// stored reply, not even an "unmatched" entry. Detection prefers the \Junk
// special-use flag, with a name fallback (IONOS names the folder "Spam"). Falls
// back to INBOX-only if the server won't list folders.
async function replyFolders(client: ImapFlow): Promise<string[]> {
  const folders = ["INBOX"];
  try {
    for (const box of await client.list()) {
      const path = box.path || "";
      if (!path || path.toUpperCase() === "INBOX") continue;
      const special = String(box.specialUse || "").toLowerCase(); // e.g. "\\junk"
      const leaf = (path.split(/[./]/).pop() || "").toLowerCase(); // "INBOX.Spam" → "spam"
      if (special.includes("junk") || /^(spam|junk|bulk|junk[- ]?e-?mail)$/.test(leaf)) {
        folders.push(path);
      }
    }
  } catch { /* listing failed → INBOX only */ }
  return folders;
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
  deduped: number;     // duplicate copies removed (true owner already held the same reply)
  conflicts: number;   // correct owner already held a DIFFERENT reply — left untouched
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
// `codeOnly` = automatic-safe mode: act ONLY on unique subject-code ([MZ-…])
// matches, never the name heuristic (unsafe for same-named candidates). The
// reply poller calls this with codeOnly=true so coded mis-attributions self-heal;
// the System-page button calls it with codeOnly=false for the full manual review.
export async function reconcileReplies(apply = false, codeOnly = false): Promise<ReconcileResult> {
  const result: ReconcileResult = { applied: apply, scanned: 0, reassigned: 0, deduped: 0, conflicts: 0, unmatched: 0, moves: [] };

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
    const codeOwner = ref ? group.find((s) => outreachRef(s.id) === ref) : undefined;
    const owner =
      codeOwner ||
      group.find((s) => {
        const nm = s.match?.candidate?.name?.toLowerCase();
        return nm && nm.length > 2 && hay.includes(nm);
      });

    if (!owner) { result.unmatched++; continue; }   // can't tell — leave as is
    if (owner.id === o.id) continue;                 // already correct
    // Automatic (codeOnly) mode: only act on a UNIQUE subject-code match. A
    // name-based match is a heuristic — two same-named candidates would be
    // confused — so it's left for manual review on the System page.
    if (codeOnly && !codeOwner) { result.unmatched++; continue; }
    if (owner.status === "REPLIED" && owner.replySubject) {
      // The true owner already holds a reply. If it's the SAME message (classic
      // duplication: one mail attached to several candidates, one per poll),
      // just clear the wrongly-tagged copy — the owner keeps the real one.
      if (owner.replySubject === o.replySubject) {
        result.deduped++;
        result.moves.push({
          employer: o.match?.employer?.name ?? null,
          from: o.match?.candidate?.name ?? o.id,
          to: owner.match?.candidate?.name ?? owner.id,
          via: codeOwner ? "code" : "name",
          subject: (o.replySubject ?? "").slice(0, 120),
        });
        if (apply) {
          await prisma.outreach.update({
            where: { id: o.id },
            data: { status: "SENT", repliedAt: null, replyFrom: null, replySubject: null, replyText: null },
          });
          await prisma.match.update({ where: { id: o.matchId }, data: { status: "SENT" } }).catch(() => {});
        }
        continue;
      }
      result.conflicts++; continue;
    }

    result.reassigned++;
    result.moves.push({
      employer: o.match?.employer?.name ?? null,
      from: o.match?.candidate?.name ?? o.id,
      to: owner.match?.candidate?.name ?? owner.id,
      via: codeOwner ? "code" : "name",
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

  // Outreach to match replies against — INCLUDING already-replied threads.
  // Matching must see the replied ones too: when the subject's [MZ-…] code or
  // candidate name points at a thread that already holds a reply, the message is
  // a continuation of THAT thread — it must never fall through to some other
  // candidate's open thread on the same domain (that's exactly how one reply
  // used to "infect" every candidate mailed to the employer, one per poll).
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const threads = await prisma.outreach.findMany({
    where: {
      status: { in: ["SENT", "OPENED", "REPLIED"] },
      sentAt: { gte: cutoff, not: null },
      toAddress: { not: null },
    },
    select: {
      id: true, toAddress: true, sentAt: true, matchId: true, status: true,
      repliedAt: true, replySubject: true,
      match: { select: { employerId: true, candidate: { select: { name: true } } } },
    },
    orderBy: { sentAt: "desc" },
  });

  // Skip messages we've already recorded (same subject + same envelope date):
  // the IMAP window re-reads the same mails on every poll.
  const storedKeys = new Set(
    threads
      .filter((t) => t.repliedAt && t.replySubject)
      .map((t) => `${t.repliedAt!.getTime()}|${t.replySubject}`)
  );

  // Index by recipient domain (employers often reply from a personal address on
  // the same domain, e.g. we mail info@hotel.de, a person replies from
  // max@hotel.de), with an exact-address fast path too.
  const byDomain = new Map<string, typeof threads>();
  const byAddress = new Map<string, typeof threads>();
  // Also index by the subject reference code across ALL recent threads, so a
  // reply that carries "[MZ-…]" but comes from an address/domain we never mailed
  // (employer forwarded it, or answered from a personal mailbox) can still be
  // matched to its exact outreach. The code is unique per outreach, so this can
  // never mis-attribute — it only recovers replies the domain index would miss.
  const byRef = new Map<string, typeof threads[number]>();
  for (const o of threads) {
    const d = domainOf(o.toAddress);
    if (d) (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(o);
    const a = o.toAddress!.toLowerCase();
    (byAddress.get(a) ?? byAddress.set(a, []).get(a)!).push(o);
    byRef.set(outreachRef(o.id), o);
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
    // Process one fetched message against the shared thread index. Extracted so
    // INBOX and every Junk/Spam folder run the identical matching logic; returns
    // early where the old inline loop used `continue`.
    const handleMessage = async (msg: FetchMessageObject) => {
        result.scanned++;
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const fromName = msg.envelope?.from?.[0]?.name ?? "";
        const subject = msg.envelope?.subject ?? "";
        const msgDate = msg.envelope?.date ?? new Date();
        if (!fromAddr) return;

        const senderDomain = domainOf(fromAddr) ?? "";

        // Already recorded on a previous poll? The IMAP window re-reads the same
        // messages every run — without this, the second run re-matches the mail
        // and (its true thread now REPLIED) attaches it to ANOTHER candidate.
        if (storedKeys.has(`${msgDate.getTime()}|${subject.slice(0, 300)}`)) return;

        // Threads this reply could belong to: exact address first, then
        // same-domain; only ones sent before the reply arrived.
        const candidates =
          byAddress.get(fromAddr) ?? byDomain.get(senderDomain) ?? [];
        const eligible = candidates.filter((o) => o.sentAt && o.sentAt <= msgDate);
        const openOnly = eligible.filter((o) => o.status !== "REPLIED");

        // 1) EXCLUSIVE: the unique reference code carried in the subject
        //    ("… [MZ-1A2B3C4]") identifies exactly one outreach — even for
        //    same-named candidates, and even if that thread already replied
        //    (second message in the thread → update it). A code that matches
        //    nothing here means "not one of these threads": never fall through.
        const replyRef = parseRefTag(subject);
        // 2) Candidate name in the subject (mails sent before the code existed:
        //    "Bewerbung als <title> – <name>") — searched across ALL threads,
        //    replied ones included, for the same reason.
        const subjLc = subject.toLowerCase();
        const nameOwner = eligible.find((o) => {
          const nm = o.match?.candidate?.name?.toLowerCase();
          return nm && nm.length > 2 && subjLc.includes(nm);
        });
        // 3) Last resort (no code, no name): the newest still-open thread on the
        //    domain. Never a replied one — and never when the subject names a
        //    different candidate (nameOwner covers that above).
        // For a coded reply, prefer the domain-scoped match, then fall back to the
        // GLOBAL code index — so a reply from a different sender domain that kept
        // the code is still linked (a personal mailbox / forwarded answer). The
        // sentAt<=msgDate guard keeps a reply from predating its own send.
        let target = replyRef
          ? eligible.find((o) => outreachRef(o.id) === replyRef)
          : nameOwner ?? openOnly[0];
        if (!target && replyRef) {
          const g = byRef.get(replyRef);
          if (g && g.sentAt && g.sentAt <= msgDate) target = g;
        }

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

        if (!target) return;

        const replyStored = `${subject}\n\n${body}`.trim().slice(0, 4000);

        // What does the answer SAY? (interested / interview / rejected / …)
        // Fail-soft — classification must never block reply capture.
        const replyCategory = await classifyReply(subject, body).catch(() => null);

        await prisma.outreach.update({
          where: { id: target.id },
          data: {
            status: "REPLIED",
            repliedAt: msgDate,
            replyFrom: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
            replySubject: subject.slice(0, 300),
            replyText: replyStored,
            ...(replyCategory ? { replyCategory } : {}),
          },
        });
        await prisma.match.update({
          where: { id: target.matchId },
          data: { status: "REPLIED" },
        }).catch(() => {});
        // (opt-out already handled above, before the target check)

        // Ping the operator immediately for promising replies (interested /
        // interview) so they don't have to watch the inbox. Fail-soft.
        if (replyCategory) {
          await notifyImportantReply({
            outreachId: target.id,
            category: replyCategory,
            candidateName: target.match?.candidate?.name ?? null,
            employerId: target.match?.employerId ?? null,
            subject,
            replyText: body || subject,
          });
        }

        // Remember this message as stored (in-run dedupe) and mark the thread
        // replied in the in-memory index so a later message in this run can't
        // grab it via the open-thread fallback.
        storedKeys.add(`${msgDate.getTime()}|${subject.slice(0, 300)}`);
        target.status = "REPLIED";
        result.matched++;
    };

    // Scan INBOX + any Junk/Spam folder. A per-folder try keeps one bad folder
    // from aborting the rest; logout always runs.
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    for (const folder of await replyFolders(client)) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const uids = await client.search({ since }, { uid: true });
          if (uids && uids.length) {
            for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
              await handleMessage(msg);
            }
          }
        } finally {
          lock.release();
        }
      } catch (e) {
        result.errors.push(`scan ${folder} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return result;
}

export interface UnmatchedReply {
  from: string;
  fromName: string;
  subject: string;
  date: string;
  snippet: string;
  domain: string;
  // Same AI category as matched replies (Sual verir / Rədd / Avtomatik …) so
  // unmatched mail is filterable by the inbox category chips too. null = the
  // classifier failed for this one.
  category: string | null;
  // Candidates we mailed that domain — the reply most likely concerns one of
  // them; id lets the UI attach that candidate's CV to a reply.
  candidates: { id: string; name: string }[];
}
export interface UnmatchedScanResult {
  scanned: number;
  unmatched: UnmatchedReply[];
  errors: string[];
}

/**
 * Read the inbox and return replies from a CONTACTED employer domain that are
 * NOT linked to any candidate — i.e. a real reply the auto-matcher couldn't
 * attribute (employer answered from a different address, subject lost the code,
 * etc.). Nothing is stored; this is a read-only "so no reply is ever invisible"
 * view. Newsletters/spam are excluded because their domain was never contacted.
 */
export async function scanUnmatchedReplies(sinceDays = 14): Promise<UnmatchedScanResult> {
  const result: UnmatchedScanResult = { scanned: 0, unmatched: [], errors: [] };

  const host = process.env.IMAP_HOST || "imap.ionos.de";
  const port = parseInt(process.env.IMAP_PORT || "993");
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  if (!user || !pass) {
    result.errors.push("IMAP credentials not configured");
    return result;
  }

  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const sent = await prisma.outreach.findMany({
    where: { sentAt: { gte: cutoff, not: null }, toAddress: { not: null } },
    select: {
      toAddress: true, repliedAt: true, replySubject: true, replyFrom: true,
      match: { select: { candidate: { select: { id: true, name: true } } } },
    },
  });
  // Pull the bare address out of a stored "Name <addr>" replyFrom value.
  const addrOf = (s: string | null | undefined): string => {
    const m = s?.match(/<([^>]+)>/);
    return (m ? m[1] : s ?? "").toLowerCase().trim();
  };
  // domain → candidateId → name of the candidates we mailed there.
  const candsByDomain = new Map<string, Map<string, string>>();
  // Keys of replies ALREADY linked (so we don't re-list them as "unmatched").
  // Keyed by SENDER + subject, not subject alone: generic German subjects
  // ("AW: Ihre Bewerbung", "Automatische Antwort") repeat across employers, and a
  // subject-only key would suppress a genuine unmatched reply the moment ANY
  // employer's reply with the same subject had been matched.
  const linkedKeys = new Set<string>();
  for (const o of sent) {
    const d = domainOf(o.toAddress);
    if (d) {
      const c = o.match?.candidate;
      if (c?.id && c?.name) (candsByDomain.get(d) ?? candsByDomain.set(d, new Map()).get(d)!).set(c.id, c.name);
    }
    if (o.repliedAt && o.replySubject) linkedKeys.add(`${addrOf(o.replyFrom)}|${o.replySubject.slice(0, 200).toLowerCase()}`);
  }
  if (candsByDomain.size === 0) return result; // nothing sent yet

  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false, socketTimeout: 20000 });
  try {
    await client.connect();
  } catch (err) {
    result.errors.push(`IMAP connect failed: ${(err as Error).message}`);
    return result;
  }
  try {
    // De-dupe across folders: the same reply won't be in two folders, but guard
    // anyway so a message copied to both INBOX and Spam is listed once.
    const seen = new Set<string>();
    const handleMessage = async (msg: FetchMessageObject) => {
        result.scanned++;
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        if (!fromAddr) return;
        const domain = domainOf(fromAddr) ?? "";
        const cands = candsByDomain.get(domain);
        if (!cands) return; // not from a contacted employer → skip (newsletter/spam)
        const subject = msg.envelope?.subject ?? "";
        if (linkedKeys.has(`${fromAddr}|${subject.slice(0, 200).toLowerCase()}`)) return; // already linked (this sender)
        const msgDate = msg.envelope?.date ?? new Date();
        const dedupeKey = `${fromAddr}|${subject.slice(0, 200).toLowerCase()}|${msgDate.toISOString().slice(0, 10)}`;
        if (seen.has(dedupeKey)) return; // same reply already listed from another folder
        seen.add(dedupeKey);
        let body = "";
        try { if (msg.source) body = ((await simpleParser(msg.source)).text || "").trim(); } catch { /* ignore */ }
        // Classify like a matched reply (heuristics first, then Haiku) so the
        // inbox category chips include unmatched mail too. Fail-soft → null.
        let category: string | null = null;
        try { category = await classifyReply(subject, body); } catch { category = null; }
        result.unmatched.push({
          from: fromAddr,
          fromName: msg.envelope?.from?.[0]?.name ?? "",
          subject,
          date: msgDate.toISOString(),
          category,
          // Keep enough of the body to read the whole message (employer replies
          // are short); strip the quoted original after common reply separators.
          snippet: body
            .split(/-----Ursprüngliche Nachricht-----|________________________________|^Von:\s|^Gesendet:\s/m)[0]
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 2000),
          domain,
          candidates: Array.from(cands.entries()).map(([id, name]) => ({ id, name })),
        });
    };

    // Scan INBOX + any Junk/Spam folder; per-folder try, logout always runs.
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    for (const folder of await replyFolders(client)) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const uids = await client.search({ since }, { uid: true });
          if (uids && uids.length) {
            for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
              await handleMessage(msg);
            }
          }
        } finally {
          lock.release();
        }
      } catch (e) {
        result.errors.push(`scan ${folder} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  result.unmatched.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}
