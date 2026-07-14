import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { sendMail, type MailAttachment } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB across all attachments

// Pull a bare email address out of a "Name <email>" string (or a plain address).
function addressOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/<([^>]+)>/);
  const raw = (m ? m[1] : s).trim();
  return /\S+@\S+\.\S+/.test(raw) ? raw : null;
}

// Keep the thread subject; prefix "AW:" only if it isn't already a reply.
function replySubject(subject: string | null | undefined): string {
  const base = (subject || "Bewerbung").trim();
  return /^(aw|re|antw)\s*:/i.test(base) ? base : `AW: ${base}`;
}

// POST /api/inbox/[id]/reply — reply to an employer's message straight from the
// app (no IONOS webmail). Multipart body: `text` + optional `files`. Sends from
// the MZ address and records the reply so it shows in the thread.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const outreach = await prisma.outreach.findUnique({
      where: { id: params.id },
      select: {
        id: true, replyFrom: true, replySubject: true, subject: true, toAddress: true,
        match: { select: { employerId: true, candidateId: true } },
      },
    });
    if (!outreach) return NextResponse.json({ error: "Nachricht nicht gefunden" }, { status: 404 });

    const to = addressOf(outreach.replyFrom) || addressOf(outreach.toAddress);
    if (!to) return NextResponse.json({ error: "Keine Empfängeradresse gefunden" }, { status: 400 });

    const form = await req.formData();
    const text = String(form.get("text") ?? "").trim();
    if (!text) return NextResponse.json({ error: "Text ist leer" }, { status: 400 });

    // Collect uploaded files → mail attachments (bounded in count and size).
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Maximal ${MAX_FILES} Dateien` }, { status: 400 });
    let total = 0;
    const attachments: MailAttachment[] = [];
    const attachmentsMeta: { filename: string; size: number }[] = [];
    for (const f of files) {
      total += f.size;
      if (total > MAX_TOTAL_BYTES) return NextResponse.json({ error: "Anhänge zu groß (max. 15 MB)" }, { status: 400 });
      const buf = Buffer.from(await f.arrayBuffer());
      attachments.push({ filename: f.name || "anhang", content: buf });
      attachmentsMeta.push({ filename: f.name || "anhang", size: f.size });
    }

    const subject = replySubject(outreach.replySubject || outreach.subject);
    const sent = await sendMail({ to, subject, text, attachments: attachments.length ? attachments : undefined });

    const actor = await getSessionUser(req);
    const saved = await prisma.outboundReply.create({
      data: {
        outreachId: outreach.id,
        toAddress: to,
        subject,
        body: text,
        attachments: attachmentsMeta.length ? attachmentsMeta : undefined,
        sentBy: actor,
        provider: sent.provider,
        providerId: sent.id,
      },
      select: { id: true, toAddress: true, subject: true, body: true, attachments: true, createdAt: true },
    });

    await logAudit({
      actor, action: "OUTREACH_SEND", targetType: "inbox-reply", targetId: outreach.id,
      meta: { to, attachments: attachmentsMeta.length },
    });

    return NextResponse.json({ ok: true, reply: saved });
  } catch (err) {
    return apiError(err);
  }
}
