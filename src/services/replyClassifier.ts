/**
 * Reply classification — what does the employer's answer actually say?
 * Powers the inbox category filters ("interested", "interview", "rejected"…).
 *
 * Two stages: free heuristics catch the unambiguous cases (auto-replies,
 * opt-outs); everything else goes to the cheapest model (Haiku) with a strict
 * one-word answer format. Fail-soft: on any error the reply just stays
 * uncategorised (OTHER is only assigned by a successful classification).
 */

import { anthropic, extractText } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";
import type { ReplyCategory } from "@prisma/client";

const AUTO_REPLY_MARKERS = [
  "abwesenheit", "out of office", "außer haus", "ausser haus", "automatische antwort",
  "automatisch generiert", "eingangsbestätigung", "eingangsbestaetigung", "auto-reply",
  "autoreply", "wir haben ihre e-mail erhalten", "ihre nachricht ist eingegangen",
  "bin ab dem", "bin bis zum", "nicht im büro", "nicht im buero", "urlaub",
];

const OPT_OUT_MARKERS = [
  "keine weiteren", "nicht mehr kontaktieren", "abmelden", "unsubscribe", "kein interesse an weiteren",
  "aus dem verteiler", "von weiteren e-mails absehen", "keine e-mails mehr",
];

const VALID: ReplyCategory[] = ["INTERESTED", "INTERVIEW", "QUESTION", "REJECTED", "AUTO_REPLY", "OPT_OUT", "OTHER"];

export async function classifyReply(subject: string, text: string): Promise<ReplyCategory> {
  const hay = `${subject}\n${text}`.toLowerCase();

  // Free, unambiguous heuristics first.
  if (AUTO_REPLY_MARKERS.some((m) => hay.includes(m))) return "AUTO_REPLY";
  if (OPT_OUT_MARKERS.some((m) => hay.includes(m))) return "OPT_OUT";

  const prompt = `Du bekommst die Antwort eines Arbeitgebers auf eine Bewerbung, die eine Personalvermittlung geschickt hat. Ordne die Antwort GENAU EINER Kategorie zu und gib NUR das Kategorie-Wort zurück (kein anderer Text):

INTERESTED — Arbeitgeber ist interessiert, will den Kandidaten / weitere Schritte
INTERVIEW — schlägt ein Gespräch/Interview/Telefonat/Termin vor
QUESTION — stellt Rückfragen, bittet um Unterlagen/Infos (Gehalt, Verfügbarkeit, Zeugnisse…)
REJECTED — sagt ab / Stelle besetzt / passt nicht
AUTO_REPLY — automatische Antwort / Abwesenheit / Eingangsbestätigung
OPT_OUT — will keine weiteren E-Mails / bittet um Löschung
OTHER — nichts davon

Betreff: ${subject.slice(0, 200)}
Antwort:
"""${text.slice(0, 2500)}"""`;

  try {
    const message = await anthropic.messages.create({
      model: process.env.REPLY_CLASSIFIER_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = extractText(message).toUpperCase();
    const found = VALID.find((c) => raw.includes(c));
    return found ?? "OTHER";
  } catch {
    // Fail-soft: leave uncategorised rather than blocking the reply pipeline.
    return "OTHER";
  }
}

/**
 * Backfill: classify stored replies that have no category yet. Batched (the
 * model call is ~1s each); call repeatedly until remaining = 0.
 */
export async function classifyStoredReplies(limit = 25): Promise<{ classified: number; remaining: number }> {
  const rows = await prisma.outreach.findMany({
    where: { repliedAt: { not: null }, replyCategory: null },
    select: { id: true, replySubject: true, replyText: true },
    orderBy: { repliedAt: "desc" },
    take: limit,
  });

  let classified = 0;
  for (const r of rows) {
    const category = await classifyReply(r.replySubject ?? "", r.replyText ?? "");
    await prisma.outreach.update({ where: { id: r.id }, data: { replyCategory: category } });
    classified++;
  }

  const remaining = await prisma.outreach.count({ where: { repliedAt: { not: null }, replyCategory: null } });
  return { classified, remaining };
}
