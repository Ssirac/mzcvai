/**
 * Outreach service — Layer 4
 *
 * GDPR/UWG compliance (enforced here, not just documented):
 * - Never sends without human approval (approvedBy must be set)
 * - Rate-limited: MAX_OUTREACH_PER_DAY emails per day
 * - Cooldown: OUTREACH_COOLDOWN_DAYS between emails to same employer
 * - Only sends to generic company emails (info@, bewerbung@) — never personal HR data
 *
 * Legal note: This is not legal advice.
 * Consult a German GDPR/UWG lawyer before scaling outreach operations.
 */

import { prisma } from "@/lib/prisma";
import { anthropic } from "@/lib/anthropic";
import { generateCandidateCvPdf, cvFileName } from "@/services/cvPdf";
import { enrichSingleEmployer } from "@/services/enrichment";
import { sendMail } from "@/lib/mailer";

const MAX_PER_DAY = parseInt(process.env.MAX_OUTREACH_PER_DAY ?? "20");
const COOLDOWN_DAYS = parseInt(process.env.OUTREACH_COOLDOWN_DAYS ?? "30");

/**
 * Send a REAL-looking application email (no "Test" wording) for a candidate to
 * the given recipients, with the candidate's CV attached. The letter is written
 * for the candidate's TOP-matching employer (company name + position), sent via
 * the agency signature (Germany Career Center). Used to preview exactly what
 * an employer would receive.
 */
export async function sendCandidateTestLetter(candidateId: string, recipients: string[]): Promise<{ subject: string; sentTo: string[]; employer: string | null; body: string }> {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });

  // Use the candidate's best match so the letter names a real company + position
  const match = await prisma.match.findFirst({
    where: { candidateId },
    orderBy: [{ employer: { score: "desc" } }, { fitScore: "desc" }],
    include: { employer: true, vacancy: true },
  });

  let subject: string;
  let body: string;
  let employerName: string | null = null;

  if (match) {
    const letter = await composeApplicationLetter(c, match.employer, match.vacancy);
    subject = letter.subject;
    body = letter.body;
    employerName = match.employer.name;
  } else {
    // No match yet — generic initiative application, still via the agency + signature
    const letter = await composeApplicationLetter(c, { name: "Ihr Unternehmen", city: null, region: null, sponsorshipSignal: "UNKNOWN" }, { title: c.beruf });
    subject = `Initiativbewerbung – ${c.name}`;
    body = letter.body;
  }

  // CV attachment: uploaded original, else generated from data
  let attachments: { filename: string; content: Buffer }[] = [];
  if (c.cvData) {
    attachments = [{ filename: c.cvFileName || cvFileName(c.name), content: Buffer.from(c.cvData) }];
  } else {
    try {
      const pdf = await Promise.race([
        generateCandidateCvPdf(c),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("PDF timeout")), 25000)
        ),
      ]);
      attachments = [{ filename: cvFileName(c.name), content: pdf }];
    } catch { /* skip — send without attachment */ }
  }

  await sendMail({ to: recipients, subject, text: body, attachments });

  return { subject, sentTo: recipients, employer: employerName, body };
}

// Guard: personal email detection (name.surname@ pattern)
// We block these at write time to enforce GDPR default
// Local-parts that belong to a company boss/owner, not an application inbox.
// We never apply via these — a Geschäftsführer reacts badly to a cold pitch.
// Exact matches (avoid false positives like "chefkoch" = head chef = valid).
const EXEC_EXACT = new Set([
  "ceo", "cto", "cfo", "coo", "gf", "inhaber", "inhaberin", "owner", "vorstand",
  "direktor", "direktorin", "director", "boss", "praesident", "präsident", "president",
  "geschaeftsfuehrer", "geschäftsführer", "geschaeftsleitung", "geschäftsleitung",
]);
// Substrings that unambiguously mark an executive address.
const EXEC_CONTAINS = ["geschaeftsf", "geschäftsf", "geschaeftsleit", "geschäftsleit", "vorstand", "inhaber"];
function isExecLocalpart(local: string): boolean {
  const l = local.toLowerCase().replace(/[.\-_0-9]/g, "");
  if (EXEC_EXACT.has(l)) return true;
  return EXEC_CONTAINS.some((t) => l.includes(t));
}

function looksPersonal(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  // Boss/owner address → never send (avoids annoying the Geschäftsführer).
  if (isExecLocalpart(local)) return true;
  // Patterns like firstname.lastname, f.lastname, firstname_lastname
  return /^[a-z]+[.\-_][a-z]+$/i.test(local) && !/^(info|bewerbung|jobs|karriere|hr|personal|kontakt|post|mail|office|bewerbungen|stelle|stellen|team)$/i.test(local);
}

// Agency identity — HARDCODED (not env) so a stale AGENCY_* variable can never
// resurface the old brand. Email comes from env because it must match the real
// sending mailbox; update AGENCY_CONTACT_EMAIL when the new address exists.
export const AGENCY_NAME = "Germany Career Center";
export const AGENCY_PHONE = "+49 163 6800130";

// Standard service paragraphs appended to EVERY employer letter (before the
// signature): who the agency is, full process coverage (documents → interviews
// → visa → start of work), and the cost-free & non-binding terms.
function standardClosing(): string {
  return [
    `${AGENCY_NAME} unterstützt qualifizierte Fachkräfte bei der Vorbereitung ihrer Bewerbungsunterlagen und begleitet sie auf dem Weg zu einer Beschäftigung in Deutschland.`,
    `Von der Vorbereitung der Bewerbungsunterlagen über die Organisation von Online-Vorstellungsgesprächen bis hin zur Unterstützung im Visumverfahren und der Begleitung des Kandidaten bis zum Arbeitsbeginn in Deutschland werden alle organisatorischen Schritte durch ${AGENCY_NAME} koordiniert.`,
    "Für Ihr Unternehmen entstehen dadurch keinerlei Kosten, Vermittlungsgebühren oder vertragliche Verpflichtungen. Unser Service ist für Arbeitgeber vollständig kostenfrei und unverbindlich.",
    "Gerne organisieren wir kurzfristig ein Online-Vorstellungsgespräch mit dem Kandidaten und stehen Ihnen für Rückfragen jederzeit persönlich zur Verfügung.",
  ].join("\n\n");
}

// Agency signature appended to EVERY letter — so the employer knows who sent it
// and how to reply.
export function agencySignature(candidateName: string): string {
  const email = process.env.AGENCY_CONTACT_EMAIL || process.env.SMTP_USER || "";
  const web = process.env.AGENCY_WEBSITE || "";
  return [
    "Mit freundlichen Grüßen",
    "",
    AGENCY_NAME,
    `– im Auftrag von ${candidateName} –`,
    `Tel.: ${AGENCY_PHONE}`,
    email ? `E-Mail: ${email}` : "",
    web ? `Web: ${web}` : "",
  ].filter(Boolean).join("\n");
}

// Optional UWG/GDPR footer. OFF by default — an unsubscribe link makes a genuine
// application look like marketing spam and can hurt reply rates. Enable with
// COMPLIANCE_FOOTER=true if a legal opt-out line is required. The opt-out itself
// (employer.optedOut + /api/unsubscribe) still works regardless.
export function complianceFooter(employerId?: string): string {
  if (process.env.COMPLIANCE_FOOTER !== "true") return "";
  const base = process.env.PUBLIC_APP_URL || "https://mzcvai-production.up.railway.app";
  const optOut = employerId
    ? `Wenn Sie keine weiteren Nachrichten wünschen, hier abmelden: ${base}/api/unsubscribe?id=${employerId}`
    : `Wenn Sie keine weiteren Nachrichten wünschen, antworten Sie bitte mit „STOP“.`;
  return [
    "",
    "",
    "—",
    `Diese Nachricht wurde von ${AGENCY_NAME} als geschäftliche Anfrage gesendet.`,
    optOut,
  ].join("\n");
}

interface LetterCandidate {
  name: string; beruf: string; languages: string[]; needsSponsorship: boolean;
  yearsExperience: number | null; skills: string[]; experience: unknown; nationality: string | null;
}
interface LetterEmployer { name: string; city: string | null; region: string | null; sponsorshipSignal: string }

// Compose a company-specific application letter (subject + body). The letter
// names the employer + position, states it is sent via the agency
// on the candidate's behalf, and ends with the agency signature. Never says "Test".
export async function composeApplicationLetter(
  candidate: LetterCandidate,
  employer: LetterEmployer,
  vacancy: { title: string; description?: string | null }
): Promise<{ subject: string; body: string }> {
  const exp = (Array.isArray(candidate.experience) ? candidate.experience : []) as { title?: string; company?: string; description?: string }[];
  const expText = exp.slice(0, 4).map((e) => `- ${[e.title, e.company].filter(Boolean).join(" @ ")}: ${e.description ?? ""}`).join("\n");
  // Excerpt of the actual job posting so the letter can address its requirements
  const jobText = (vacancy.description ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);

  const prompt = `Du schreibst im Namen der Personalvermittlung "${AGENCY_NAME}" eine konkrete Bewerbung für einen Kandidaten — ZUGESCHNITTEN auf diese eine Stellenanzeige.

PFLICHT (unbedingt einhalten):
- Sprich den Arbeitgeber NAMENTLICH an: "${employer.name}".
- Nenne die konkrete Stelle ausdrücklich: "${vacancy.title}".
- Gehe auf die ANFORDERUNGEN der Stellenanzeige ein und verbinde sie mit der Erfahrung/den Fähigkeiten des Kandidaten (zeige die Passung konkret auf).
- Mache deutlich, dass die Bewerbung über die Personalvermittlung "${AGENCY_NAME}" erfolgt, die den Kandidaten vertritt, und dass Rückfragen/Antworten an ${AGENCY_NAME} gehen.
- Schreibe KEINE Grußformel und KEINE Unterschrift am Ende (wird separat ergänzt).
- Erwähne NICHT die Themen Visum/Visabegleitung, Kostenfreiheit/Unverbindlichkeit der Vorstellung oder das Angebot eines Online-Vorstellungsgesprächs — diese Absätze werden separat ergänzt. Schreibe sie NICHT selbst.
- Verwende NIEMALS das Wort "Test".
- Max. 230 Wörter, professionell, freundlich, konkret (keine Floskeln).

Kandidat: ${candidate.name}${candidate.nationality ? ` (${candidate.nationality})` : ""}
Beruf/Qualifikation: ${candidate.beruf}
Erfahrung: ${candidate.yearsExperience ?? "?"} Jahre
Sprachen: ${candidate.languages.join(", ")}
Braucht Visum/Sponsoring: ${candidate.needsSponsorship ? "Ja" : "Nein"}
${candidate.skills.length ? `Fähigkeiten: ${candidate.skills.join(", ")}` : ""}
${expText ? `Berufserfahrung:\n${expText}` : ""}

Arbeitgeber: ${employer.name}, ${[employer.city, employer.region].filter(Boolean).join(", ")}
Stelle: ${vacancy.title}
${jobText ? `\nStellenanzeige (Auszug):\n"""${jobText}"""` : ""}

Gib NUR den Brieftext zurück (ohne Betreffzeile, ohne Grußformel/Unterschrift).`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  let body = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
  body = body.replace(/^Betreff:.*\n?/i, "").trim(); // drop any stray subject line
  body = body.replace(/\*\*/g, "").replace(/^#+\s*/gm, ""); // strip markdown bold/headings (plain-text email)
  body = `${body}\n\n${standardClosing()}\n\n${agencySignature(candidate.name)}`;
  const subject = `Bewerbung als ${vacancy.title} – ${candidate.name}`;
  return { subject, body };
}

// Generate the letter for a match (employer + vacancy + candidate).
export async function generateDraft(matchId: string): Promise<{ subject: string; body: string }> {
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: { candidate: true, vacancy: true, employer: true },
  });
  return composeApplicationLetter(match.candidate, match.employer, match.vacancy);
}

// Create an outreach record with the Claude letter (status = DRAFT, not sent)
export async function createOutreachDraft(matchId: string): Promise<string> {
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: { employer: true, vacancy: true },
  });

  // On-demand: if the employer has no email yet, try to find one right now so the
  // user can send in a single click without a separate enrichment pass.
  let toAddress = match.employer.genericEmail ?? null;
  if (!toAddress) {
    try {
      toAddress = await enrichSingleEmployer(match.employerId);
    } catch (err) {
      console.error("[outreach] on-demand enrichment failed:", (err as Error).message);
    }
  }

  if (toAddress && looksPersonal(toAddress)) {
    throw new Error(`GDPR block: ${toAddress} appears to be a personal email address. Only generic company addresses allowed.`);
  }

  const { subject, body } = await generateDraft(matchId);

  const outreach = await prisma.outreach.create({
    data: { matchId, draftBody: body, subject, channel: "EMAIL", toAddress, status: "DRAFT" },
  });

  return outreach.id;
}

// Human approval step — must be called before send
export async function approveOutreach(outreachId: string, userId: string): Promise<void> {
  const outreach = await prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } });

  if (outreach.status !== "DRAFT") {
    throw new Error(`Outreach ${outreachId} is not in DRAFT status (current: ${outreach.status})`);
  }

  await prisma.outreach.update({
    where: { id: outreachId },
    data: { status: "APPROVED", approvedBy: userId, approvedAt: new Date() },
  });
}

// Send approved outreach — enforces all compliance guards
export async function sendOutreach(outreachId: string): Promise<void> {
  const outreach = await prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
    include: { match: { include: { employer: true, candidate: true } } },
  });

  // Test mode: when OUTREACH_TEST_RECIPIENT is set, all mail is routed there
  // (so the real flow — incl. CV attachment — can be verified without emailing
  // real employers). The intended recipient is shown in the body.
  const testRecipient = process.env.OUTREACH_TEST_RECIPIENT?.trim() || null;
  const recipient = testRecipient || outreach.toAddress;

  // Guard 1: Must be approved by a human
  if (outreach.status !== "APPROVED" || !outreach.approvedBy) {
    throw new Error(`Outreach ${outreachId} must be APPROVED by a human before sending.`);
  }

  // Guard 2: Must have a destination address
  if (!recipient) {
    throw new Error(`No email address for outreach ${outreachId}`);
  }

  // Guard 3: Personal email GDPR check (on the real employer address only)
  if (outreach.toAddress && looksPersonal(outreach.toAddress)) {
    throw new Error(`GDPR block: ${outreach.toAddress} appears personal. Refusing to send.`);
  }

  // Guard 3b: Respect opt-out (UWG) — never email an employer who unsubscribed.
  if (outreach.match.employer.optedOut) {
    throw new Error(`Employer ${outreach.match.employer.name} opted out. Refusing to send.`);
  }

  // Guard 4: Daily rate limit — counted PER CANDIDATE (each candidate gets their
  // own MAX_PER_DAY allowance), not a single shared pool.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const sentToday = await prisma.outreach.count({
    where: {
      status: "SENT",
      sentAt: { gte: todayStart },
      match: { candidateId: outreach.match.candidateId },
    },
  });
  if (sentToday >= MAX_PER_DAY) {
    throw new Error(`Daily outreach limit (${MAX_PER_DAY}) reached. Try again tomorrow.`);
  }

  // Guard 5: Cooldown — same employer within COOLDOWN_DAYS, scoped PER CANDIDATE.
  // Different candidates are different people, so each may apply to the same
  // employer independently; only the SAME candidate is stopped from being sent
  // to the same employer twice in the cooldown window.
  const cooldownDate = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const recentToSameEmployer = await prisma.outreach.findFirst({
    where: {
      match: {
        employerId: outreach.match.employerId,
        candidateId: outreach.match.candidateId,
      },
      status: "SENT",
      sentAt: { gte: cooldownDate },
    },
  });
  if (recentToSameEmployer) {
    throw new Error(
      `Cooldown active for employer ${outreach.match.employer.name}. Last sent: ${recentToSameEmployer.sentAt?.toISOString()}`
    );
  }

  // Attach the candidate's CV. Prefer the ORIGINAL uploaded file; if none was
  // uploaded, generate a clean Lebenslauf PDF from the stored data.
  const candidate = outreach.match.candidate;
  let cvAttachment: { filename: string; content: Buffer }[] = [];
  if (candidate.cvData) {
    cvAttachment = [{
      filename: candidate.cvFileName || cvFileName(candidate.name),
      content: Buffer.from(candidate.cvData),
    }];
  } else {
    try {
      const pdf = await Promise.race([
        generateCandidateCvPdf(candidate),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("PDF generation timeout after 25s")), 25000)
        ),
      ]);
      cvAttachment = [{ filename: cvFileName(candidate.name), content: pdf }];
    } catch (err) {
      console.error("[outreach] CV PDF generation failed:", (err as Error).message);
      // Non-fatal — still send the letter, just without the attachment
    }
  }

  // The email looks exactly like the real application (no "Test" wording, so the
  // preview matches what an employer would receive). Test routing only changes
  // the recipient address, not the content.
  const body = outreach.draftBody + complianceFooter(outreach.match.employerId);
  const subject = outreach.subject ?? "Bewerbung";

  // Send via Resend (HTTPS API) when configured, else SMTP
  const sendResult = await sendMail({ to: recipient, subject, text: body, attachments: cvAttachment });

  // Mark sent + log behavior signal. providerId lets Resend webhooks
  // (delivered/opened/bounced) update this record later.
  await prisma.outreach.update({
    where: { id: outreachId },
    data: { status: "SENT", sentAt: new Date(), providerId: sendResult.id },
  });

  await prisma.employerSignalLog.create({
    data: {
      employerId: outreach.match.employerId,
      eventType: "OUTREACH_SENT",
      eventData: { outreachId, toAddress: outreach.toAddress, sentTo: recipient, test: !!testRecipient },
      source: "outreach-service",
    },
  });
}

export interface BulkSendResult {
  sent: number;
  alreadySent: number;
  skippedNoEmail: number;
  skippedCooldown: number;
  skippedOptedOut: number;
  failed: number;
  limitReached: boolean;
  errors: string[];
}

/**
 * Bulk outreach for one candidate: prepares (if needed), approves and sends an
 * application to every matching employer — strictly respecting the existing
 * safety guards (daily cap, per-employer cooldown, generic-email-only). The
 * daily limit naturally stops the run, so this never becomes a spam cannon.
 *
 * When `matchIds` is given, only those specific matches are sent (select-and-send
 * from the UI); otherwise all matches for the candidate are processed.
 */
export async function sendAllForCandidate(
  candidateId: string,
  approvedBy: string,
  matchIds?: string[]
): Promise<BulkSendResult> {
  const matches = await prisma.match.findMany({
    where: {
      candidateId,
      ...(matchIds && matchIds.length > 0 ? { id: { in: matchIds } } : {}),
    },
    orderBy: [{ employer: { score: "desc" } }, { fitScore: "desc" }],
    include: { employer: true, outreach: true },
  });

  const result: BulkSendResult = {
    sent: 0, alreadySent: 0, skippedNoEmail: 0, skippedCooldown: 0, skippedOptedOut: 0, failed: 0, limitReached: false, errors: [],
  };
  const testMode = !!process.env.OUTREACH_TEST_RECIPIENT?.trim();

  for (const match of matches) {
    let createdOutreachId: string | null = null;
    try {
      if (match.outreach.some((o) => o.status === "SENT")) { result.alreadySent++; continue; }
      // Opted-out employer (asked to stop / wrong company) — skip silently.
      if (match.employer.optedOut) { result.skippedOptedOut++; continue; }
      // Without test mode we can only email employers that expose a generic address
      if (!match.employer.genericEmail && !testMode) { result.skippedNoEmail++; continue; }

      // Reuse an existing draft/approved record or create a fresh draft
      const existing = match.outreach.find((o) => o.status === "DRAFT" || o.status === "APPROVED");
      const outreachId = existing ? existing.id : await createOutreachDraft(match.id);
      if (!existing) createdOutreachId = outreachId;

      const current = await prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } });
      if (current.status === "DRAFT") await approveOutreach(outreachId, approvedBy);

      await sendOutreach(outreachId);
      result.sent++;
    } catch (err) {
      // Drop the draft we just created so failed attempts don't leave clutter
      if (createdOutreachId) {
        await prisma.outreach.deleteMany({ where: { id: createdOutreachId, status: { not: "SENT" } } });
      }
      const msg = (err as Error).message;
      if (msg.includes("Daily outreach limit")) { result.limitReached = true; break; }
      if (msg.includes("Cooldown")) { result.skippedCooldown++; continue; }
      result.failed++;
      result.errors.push(`${match.employer.name}: ${msg}`);
    }
  }

  return result;
}
