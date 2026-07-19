import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";
import { sendMail, type MailAttachment } from "@/lib/mailer";
import { generateCandidateCvPdf, cvFileName } from "@/services/cvPdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.toLowerCase().split("@")[1];
  return at ? at.replace(/^www\./, "") : null;
}
function replySubject(subject: string): string {
  const base = (subject || "Bewerbung").trim();
  return /^(aw|re|antw)\s*:/i.test(base) ? base : `AW: ${base}`;
}

// POST /api/inbox/unmatched-reply — reply to an UNMATCHED mailbox message (one
// the auto-matcher couldn't link to a candidate) straight from the app.
// Multipart body: to, subject, text, optional candidateId (attach that CV) +
// files. Safety: `to` must be an employer domain we've actually contacted — the
// feature can't be used to mail an arbitrary address.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const to = String(form.get("to") ?? "").trim().toLowerCase();
    const text = String(form.get("text") ?? "").trim();
    const subjectIn = String(form.get("subject") ?? "").trim();
    const candidateId = String(form.get("candidateId") ?? "").trim();

    if (!/^\S+@\S+\.\S+$/.test(to)) return NextResponse.json({ error: "Ungültige E-Mail-Adresse" }, { status: 400 });
    if (!text) return NextResponse.json({ error: "Text ist leer" }, { status: 400 });

    // Only reply to a domain we actually mailed (guards against sending to an
    // arbitrary address pulled from an inbox message).
    const dom = domainOf(to);
    const contacted = await prisma.outreach.findMany({
      where: { sentAt: { not: null }, toAddress: { not: null } },
      select: { toAddress: true },
    });
    const contactedDomains = new Set(contacted.map((o) => domainOf(o.toAddress)).filter(Boolean));
    if (!dom || !contactedDomains.has(dom)) {
      return NextResponse.json({ error: "Nur an kontaktierte Arbeitgeber möglich" }, { status: 403 });
    }

    // Attachments: uploaded files (bounded) + optional candidate CV.
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
    if (candidateId) {
      const cand = await prisma.candidate.findUnique({ where: { id: candidateId } });
      if (cand) {
        try {
          const content = cand.cvData ? Buffer.from(cand.cvData) : await generateCandidateCvPdf(cand);
          const filename = cand.cvFileName || cvFileName(cand.name);
          attachments.push({ filename, content });
          attachmentsMeta.push({ filename, size: content.length });
        } catch (e) {
          console.error("[unmatched-reply] CV attach failed:", (e as Error).message);
        }
      }
    }

    const subject = replySubject(subjectIn);
    const sent = await sendMail({ to, subject, text, attachments: attachments.length ? attachments : undefined });

    const actor = await getSessionUser(req);
    await logAudit({
      actor, action: "OUTREACH_SEND", targetType: "unmatched-reply", targetId: to,
      meta: { to, subject, attachments: attachmentsMeta.length },
    });

    return NextResponse.json({ ok: true, to, subject, provider: sent.provider });
  } catch (err) {
    return apiError(err);
  }
}
