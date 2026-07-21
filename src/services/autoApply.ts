/**
 * Auto-apply engine — server-side, headless-Puppeteer submission of FORM-based
 * job applications for a candidate.
 *
 * This is the AUTOMATED counterpart to the human MZ-Autofill extension. The
 * system owner explicitly enabled full auto-submit for captcha-free forms and
 * accepted the compliance responsibility; every rail below exists to make that
 * safe and reversible.
 *
 * SAFETY RAILS (all enforced here):
 *  1. OFF by default            — AUTO_FORM_APPLY_ENABLED must equal "true".
 *  2. DRY-RUN by default        — AUTO_FORM_APPLY_DRY_RUN!=="false": fill + report,
 *                                 never click submit. Flip to "false" to send.
 *  3. captcha / OTP / login     — NEVER auto-handled. Routed to the human robot
 *                                 queue (enqueueCaptcha), exactly as before.
 *  4. no garbage submissions    — if ANY required field is left empty after the
 *                                 fill, the job goes to the human queue instead of
 *                                 being submitted.
 *  5. legal consent boxes       — auto-ticked ONLY when AUTO_FORM_APPLY_ACCEPT_CONSENT
 *                                 ==="true" (default off); otherwise they read as
 *                                 missing-required and route to a human.
 *  6. dedupe                    — a pairing already applied/queued is never redone.
 *  7. opt-out + completeness    — opted-out employers and incomplete/no-CV
 *                                 candidates are skipped.
 *  8. daily cap                 — AUTO_FORM_APPLY_DAILY_CAP submissions/day.
 *  9. SSRF guard                — never points the browser at a private host.
 * Every action is written to JobApplicationLog for a full audit trail.
 */

import { load } from "cheerio";
import { prisma } from "@/lib/prisma";
import { launchBrowser } from "@/lib/browser";
import { detectCaptcha, enqueueCaptcha, buildPrefillData } from "@/services/captcha";
import { isSafeExternalTarget } from "@/lib/urlGuard";
import { BLOCKED_HOSTS } from "@/lib/actionable";
import { buildApplicationFields, APPLICATION_CANDIDATE_SELECT } from "@/lib/applicationFields";
import { FILL_SCRIPT, dedupeMissing, type FillReport, type MappedFillResult } from "@/lib/formFill";
import { classifyAndMapForm } from "@/services/formClassifier";
import { firecrawlAvailable, discoverApplyUrl } from "@/services/firecrawl";

const OTP_MARKERS = [
  "one-time", "one time password", "otp", "verification code", "bestätigungscode",
  "bestaetigungscode", "sicherheitscode", "magic link", "zwei-faktor", "zwei faktor",
  "two-factor", "2fa", "mfa", "einmalpasswort", "sms-code", "sms code",
];
const DEAD_PHRASES = [
  "nicht mehr verfügbar", "nicht mehr verfuegbar", "nicht mehr online", "nicht mehr aktuell",
  "stelle ist besetzt", "position wurde besetzt", "abgelaufen", "leider nicht mehr",
  "no longer available", "position filled", "this job has expired", "seite nicht gefunden",
];
const SUCCESS_MARKERS = [
  "vielen dank", "erfolgreich", "bewerbung eingegangen", "bewerbung erhalten", "bewerbung übermittelt",
  "eingegangen", "thank you", "successfully", "application received", "we have received",
  "wir haben ihre bewerbung", "ihre bewerbung wurde",
];

// Pairings we must not re-process. WOULD_APPLY (a dry-run marker) is intentionally
// NOT terminal — once real sending is enabled the pairing should proceed.
const DONE = new Set([
  "APPLIED", "APPLIED_UNCONFIRMED", "FILLED", "INTERVIEW", "OFFER",
  "WAITING_CAPTCHA", "WAITING_OTP", "WAITING_LOGIN", "NEEDS_HUMAN",
]);

function cfg() {
  return {
    enabled: process.env.AUTO_FORM_APPLY_ENABLED === "true",
    dryRun: process.env.AUTO_FORM_APPLY_DRY_RUN !== "false",            // default true
    acceptConsent: process.env.AUTO_FORM_APPLY_ACCEPT_CONSENT === "true", // default false
    requireCv: process.env.AUTO_FORM_APPLY_REQUIRE_CV !== "false",       // default true
    llm: process.env.AUTO_FORM_APPLY_LLM !== "false",                   // default on (fires only on gaps)
    dailyCap: parseInt(process.env.AUTO_FORM_APPLY_DAILY_CAP ?? "20"),
    limit: parseInt(process.env.AUTO_FORM_APPLY_LIMIT ?? "15"),
  };
}

export interface AutoApplyResult {
  enabled: boolean;
  dryRun: boolean;
  scanned: number;
  submitted: number;      // real submissions actually sent
  wouldSubmit: number;    // dry-run: would have submitted (all required fields filled)
  queuedForHuman: number; // missing required / captcha / otp / login → human queue
  blocked: number;        // captcha/otp/login specifically
  alreadyDone: number;
  noForm: number;
  firecrawlRecovered: number; // forms reached only via a Firecrawl apply-link hop
  llmMapped: number;          // runs where the LLM filled ≥1 previously-missing field
  capReached: boolean;
  errors: string[];
}

async function logApply(candidateId: string, vacancyId: string, company: string, position: string, link: string, source: string, status: string, note?: string) {
  await prisma.jobApplicationLog.upsert({
    where: { candidateId_vacancyId: { candidateId, vacancyId } },
    create: { candidateId, vacancyId, company, position, link, source, status, note },
    update: { status, company, position, link, source, note },
  }).catch(() => {});
}

/**
 * Run the auto-apply pass over FORM-based matches. Safe to call from cron; every
 * gate is re-checked per item so a mid-run config change is respected.
 */
export async function runAutoApply(opts?: {
  candidateId?: string; limit?: number; maxMs?: number;
  // On-demand overrides (admin test endpoint): run even when the env flag is off,
  // and force dry-run so a test can never submit for real.
  forceEnabled?: boolean; forceDryRun?: boolean;
}): Promise<AutoApplyResult> {
  const c = cfg();
  const enabled = opts?.forceEnabled ?? c.enabled;
  const dryRun = opts?.forceDryRun ?? c.dryRun;
  const r: AutoApplyResult = {
    enabled, dryRun, scanned: 0, submitted: 0, wouldSubmit: 0,
    queuedForHuman: 0, blocked: 0, alreadyDone: 0, noForm: 0,
    firecrawlRecovered: 0, llmMapped: 0, capReached: false, errors: [],
  };
  if (!enabled) return r;

  const limit = opts?.limit ?? c.limit;
  const maxMs = opts?.maxMs ?? 0;
  const started = Date.now();

  // Daily cap counts real submissions today across all candidates.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  let submittedToday = await prisma.jobApplicationLog.count({
    where: { status: { in: ["APPLIED", "APPLIED_UNCONFIRMED"] }, updatedAt: { gte: dayStart } },
  });

  const matches = await prisma.match.findMany({
    where: {
      ...(opts?.candidateId ? { candidateId: opts.candidateId } : { candidate: { status: "ACTIVE" } }),
      vacancy: { applyChannel: "FORM", url: { not: null }, status: "ACTIVE" },
      employer: { optedOut: false },
    },
    orderBy: [{ employer: { score: "desc" } }, { fitScore: "desc" }],
    take: limit,
    select: {
      fitScore: true,
      candidate: { select: { id: true, status: true, ...APPLICATION_CANDIDATE_SELECT } },
      employer: { select: { id: true, name: true, applyFormUrl: true, optedOut: true } },
      vacancy: { select: { id: true, title: true, url: true, applyValue: true, source: true } },
    },
  });
  if (matches.length === 0) return r;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent("MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de)");
    await page.setDefaultTimeout(20000);

    for (const m of matches) {
      if (maxMs && Date.now() - started > maxMs) break;
      if (submittedToday >= c.dailyCap) { r.capReached = true; break; }

      const cand = m.candidate, emp = m.employer, vac = m.vacancy;

      // Gate: candidate must be active, have a CV (by default) and the minimum
      // contact fields — an application with no e-mail/phone is not submittable.
      if (cand.status !== "ACTIVE") continue;
      if (c.requireCv && !cand.cvData) continue;
      if (!cand.email || !cand.phone) continue;

      const applyUrl = emp.applyFormUrl
        || (vac.applyValue && /^https?:\/\//i.test(vac.applyValue) ? vac.applyValue : null)
        || vac.url;
      if (!applyUrl) continue;
      if (!(await isSafeExternalTarget(applyUrl))) { r.noForm++; continue; }

      // Dedupe.
      const existing = await prisma.jobApplicationLog.findUnique({
        where: { candidateId_vacancyId: { candidateId: cand.id, vacancyId: vac.id } },
        select: { status: true },
      });
      if (existing && DONE.has(existing.status)) { r.alreadyDone++; continue; }

      r.scanned++;
      const prefill = buildPrefillData(cand);

      try {
        await page.goto(applyUrl, { waitUntil: "domcontentloaded" });

        // Where did we land? Aggregators redirect to sites we can't apply on.
        const finalHost = (() => { try { return new URL(page.url()).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } })();
        if (finalHost && BLOCKED_HOSTS.some((b) => finalHost.includes(b))) { r.noForm++; await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "BLOCKED", `redirected to ${finalHost}`); continue; }

        const rawHtml = await page.content();
        const html = rawHtml.toLowerCase();
        if (DEAD_PHRASES.some((p) => html.includes(p))) { r.noForm++; await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "DEAD"); continue; }

        // Blocked classes → human queue, NEVER auto-handled.
        const cap = await detectCaptcha(page);
        const $ = load(rawHtml);
        const hasPassword = $('input[type="password"]').length > 0;
        const blockedReason = cap ? cap : OTP_MARKERS.some((k) => html.includes(k)) ? "otp" : hasPassword ? "login" : null;
        if (blockedReason) {
          await enqueueCaptcha({
            jobId: vac.id, candidateId: cand.id, platform: vac.source, jobTitle: vac.title,
            company: emp.name, applicationUrl: applyUrl, matchScore: m.fitScore,
            blockedReason, prefilledData: prefill,
          }).catch(() => {});
          const st = blockedReason === "otp" ? "WAITING_OTP" : blockedReason === "login" ? "WAITING_LOGIN" : "WAITING_CAPTCHA";
          await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, st, blockedReason);
          r.blocked++; r.queuedForHuman++;
          continue;
        }

        // Fill the form (same field mapping the human extension uses).
        const { fields, cv } = buildApplicationFields(cand);
        const fillOnce = async (): Promise<FillReport | null> => {
          await page.evaluate(FILL_SCRIPT);
          const payload = JSON.stringify({ fields, cv, acceptConsent: c.acceptConsent });
          return (await page.evaluate(`window.__mzFill(${payload})`)) as FillReport;
        };
        let report = await fillOnce();

        // Firecrawl fallback: no fillable form here → find the real "Jetzt
        // bewerben" application link and retry once on that page. Only when a key
        // is configured; a blocked target on the new page still goes to a human.
        if ((!report || !report.formPresent) && firecrawlAvailable()) {
          const alt = await discoverApplyUrl(applyUrl).catch(() => null);
          if (alt && alt !== applyUrl && (await isSafeExternalTarget(alt))) {
            try {
              await page.goto(alt, { waitUntil: "domcontentloaded" });
              if (!(await detectCaptcha(page))) {
                const retry = await fillOnce();
                if (retry?.formPresent) { report = retry; r.firecrawlRecovered++; }
              }
            } catch { /* keep the original (empty) report */ }
          }
        }

        if (!report || !report.formPresent) { r.noForm++; await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "NO_FORM"); continue; }

        let missing = dedupeMissing(report.missingRequired || []);
        let filledCount = report.filled;

        // LLM pass (structure only, no PII sent): map REQUIRED fields the static
        // matcher missed, and reject a form the model says is not an application.
        if (missing.length > 0 && c.llm && report.unmatchedRequired && report.unmatchedRequired.length > 0) {
          const cls = await classifyAndMapForm({
            jobTitle: vac.title,
            filledKeys: Object.keys(fields).filter((k) => fields[k]),
            unmatched: report.unmatchedRequired,
            availableKeys: Object.keys(fields),
          });
          if (cls && cls.isApplicationForm === false && cls.confidence >= 0.7) {
            r.noForm++;
            await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "NOT_APPLICATION", `LLM: not an application form (conf ${cls.confidence})`);
            continue;
          }
          if (cls && Object.keys(cls.mapping).length > 0) {
            const mapped = (await page.evaluate(`window.__mzFillMapped(${JSON.stringify(cls.mapping)}, ${JSON.stringify(fields)})`)) as MappedFillResult;
            if (mapped) {
              filledCount += mapped.filled;
              missing = dedupeMissing(mapped.stillMissing || []);
              if (mapped.filled > 0) r.llmMapped++;
            }
          }
        }

        if (missing.length > 0) {
          // Don't submit a form we couldn't complete — hand it to a human.
          await enqueueCaptcha({
            jobId: vac.id, candidateId: cand.id, platform: vac.source, jobTitle: vac.title,
            company: emp.name, applicationUrl: applyUrl, matchScore: m.fitScore,
            blockedReason: "form", prefilledData: prefill,
          }).catch(() => {});
          await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "NEEDS_HUMAN", `filled ${filledCount}, missing: ${missing.slice(0, 6).join("; ")}`);
          r.queuedForHuman++;
          continue;
        }

        if (dryRun) {
          await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "WOULD_APPLY", `filled ${filledCount}${report.cvAttached ? " +CV" : ""}${report.consentTicked.length ? " +consent" : ""} (dry-run)`);
          r.wouldSubmit++;
          continue;
        }

        if (!report.submitMarked) {
          await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "NEEDS_HUMAN", `filled ${filledCount} but no submit button found`);
          r.queuedForHuman++;
          continue;
        }

        // SUBMIT. Click the tagged control and wait for the outcome.
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
          page.click('[data-mz-submit="1"]').catch(() => {}),
        ]);
        // Read the result page for a success acknowledgement.
        let after = "";
        try { after = (await page.content()).toLowerCase(); } catch { /* ignore */ }
        const confirmed = SUCCESS_MARKERS.some((s) => after.includes(s));
        submittedToday++;
        r.submitted++;
        await logApply(
          cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source,
          confirmed ? "APPLIED" : "APPLIED_UNCONFIRMED",
          `filled ${filledCount}${report.cvAttached ? " +CV" : ""}${report.consentTicked.length ? ` +consent(${report.consentTicked.length})` : ""}${confirmed ? "" : " — no confirmation text seen"}`,
        );
        // Gentle pace between real submissions.
        await new Promise((res) => setTimeout(res, 2000));
      } catch (err) {
        r.errors.push(`${emp.name}: ${(err as Error).message.slice(0, 140)}`);
        await logApply(cand.id, vac.id, emp.name, vac.title, applyUrl, vac.source, "ERROR", (err as Error).message.slice(0, 200));
      }
    }
  } finally {
    await browser.close();
  }
  return r;
}
