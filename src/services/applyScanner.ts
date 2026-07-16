/**
 * Apply scanner (human-in-the-loop). For FORM-based job matches it opens the
 * application URL and classifies it:
 *   • captcha (reCAPTCHA/hCaptcha/Cloudflare) or OTP/MFA  → enqueue to the robot
 *     queue + log WAITING_CAPTCHA / WAITING_OTP  (this is what raises the badge)
 *   • a fillable form (no captcha)                        → enqueue as "form" so
 *     the human opens it and the MZ Autofill extension fills it, log FORM_FOUND
 *   • already handled                                     → ALREADY_APPLIED
 *   • no form / unreachable                               → skipped / ERROR
 *
 * HARD RULES: never solves/bypasses a captcha, never submits a form. It only
 * classifies and queues; the human clears the captcha and submits (with the
 * extension doing the field-filling). Uses the existing Puppeteer, not Playwright.
 */

import { load } from "cheerio";
import { prisma } from "@/lib/prisma";
import { launchBrowser } from "@/lib/browser";
import { detectCaptcha, enqueueCaptcha, buildPrefillData } from "@/services/captcha";
import { BLOCKED_HOSTS } from "@/lib/actionable";
import { isSafeExternalUrl } from "@/lib/urlGuard";

// Phrases that mean the listing is gone — don't queue a dead job for a human.
const DEAD_PHRASES = [
  "nicht mehr verfügbar", "nicht mehr verfuegbar", "nicht mehr online", "nicht mehr aktuell",
  "stelle ist besetzt", "position wurde besetzt", "abgelaufen", "leider nicht mehr",
  "no longer available", "position filled", "this job has expired", "seite nicht gefunden",
];

const OTP_MARKERS = [
  "one-time", "one time password", "otp", "verification code", "bestätigungscode",
  "bestaetigungscode", "sicherheitscode", "magic link", "zwei-faktor", "zwei faktor",
  "two-factor", "2fa", "mfa", "einmalpasswort", "sms-code", "sms code",
];

// Terminal statuses that mean "don't re-scan this pairing".
const DONE = new Set(["APPLIED", "FILLED", "FORM_FOUND", "WAITING_CAPTCHA", "WAITING_OTP", "WAITING_LOGIN", "INTERVIEW", "OFFER"]);

export interface ApplyScanResult {
  scanned: number; captcha: number; otp: number; form: number; login: number;
  alreadyApplied: number; noForm: number; errors: number;
}

export async function runApplyScan(opts?: { candidateId?: string; limit?: number; maxMs?: number }): Promise<ApplyScanResult> {
  const limit = opts?.limit ?? parseInt(process.env.APPLY_SCAN_LIMIT ?? "20");
  const maxMs = opts?.maxMs ?? 0;
  const started = Date.now();
  const r: ApplyScanResult = { scanned: 0, captcha: 0, otp: 0, form: 0, login: 0, alreadyApplied: 0, noForm: 0, errors: 0 };

  const matches = await prisma.match.findMany({
    where: {
      ...(opts?.candidateId ? { candidateId: opts.candidateId } : { candidate: { status: { in: ["ACTIVE", "PENDING"] } } }),
      vacancy: { applyChannel: "FORM", url: { not: null }, status: "ACTIVE" },
    },
    orderBy: [{ employer: { score: "desc" } }, { fitScore: "desc" }],
    take: limit,
    select: {
      fitScore: true,
      candidate: { select: { id: true, name: true, email: true, phone: true, currentCity: true, beruf: true, germanLevel: true, nationality: true } },
      employer: { select: { id: true, name: true, applyFormUrl: true } },
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
      const cand = m.candidate, emp = m.employer, vac = m.vacancy;
      const applyUrl = emp.applyFormUrl
        || (vac.applyValue && /^https?:\/\//i.test(vac.applyValue) ? vac.applyValue : null)
        || vac.url;
      if (!applyUrl) continue;
      // SSRF guard: never point the headless browser at internal/private hosts.
      if (!isSafeExternalUrl(applyUrl)) { r.noForm++; continue; }

      // Dedup: skip pairings already resolved.
      const existing = await prisma.jobApplicationLog.findUnique({
        where: { candidateId_vacancyId: { candidateId: cand.id, vacancyId: vac.id } },
        select: { status: true },
      });
      if (existing && DONE.has(existing.status)) { r.alreadyApplied++; continue; }

      r.scanned++;
      let reason: string | null = null;
      let status = "ERROR";
      try {
        await page.goto(applyUrl, { waitUntil: "domcontentloaded" });
        const cap = await detectCaptcha(page);
        const rawHtml = await page.content();
        const html = rawHtml.toLowerCase();
        // Where did we actually land? An aggregator often redirects to a site we
        // can't apply on (StepStone, LinkedIn…) — don't queue those.
        const finalHost = (() => { try { return new URL(page.url()).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } })();
        if (finalHost && BLOCKED_HOSTS.some((b) => finalHost.includes(b))) {
          status = "BLOCKED"; r.noForm++; // reason stays null → not queued
        } else if (DEAD_PHRASES.some((p) => html.includes(p))) {
          status = "DEAD"; r.noForm++; // dead listing → not queued
        } else if (cap) { reason = cap; status = "WAITING_CAPTCHA"; r.captcha++; }
        else if (OTP_MARKERS.some((k) => html.includes(k))) { reason = "otp"; status = "WAITING_OTP"; r.otp++; }
        else {
          const $ = load(rawHtml);
          // Login wall? A password field means "sign in / create an account to
          // apply" (arbeitsagentur portal, ATS accounts…). Queue it flagged as
          // "login" so the human sees the 🔑 badge BEFORE opening — previously a
          // 2-input login form even miscounted as a ready-to-fill form.
          const hasPassword = $('input[type="password"]').length > 0;
          if (hasPassword) { reason = "login"; status = "WAITING_LOGIN"; r.login++; }
          else {
            // Fillable form? Count visible text/email/tel inputs inside a <form>
            // via cheerio in Node (no $$eval closure → bundler-safe).
            const inputs = $("form input, form textarea").filter((_, e) => {
              const type = ($(e).attr("type") || "").toLowerCase();
              return !["hidden", "submit", "button", "checkbox", "radio"].includes(type);
            }).length;
            if (inputs >= 2) { reason = "form"; status = "FORM_FOUND"; r.form++; }
            else { status = "NO_FORM"; r.noForm++; }
          }
        }
      } catch {
        r.errors++;
        status = "ERROR";
      }

      // Queue the actionable ones (captcha/otp/form) so the human + extension finish them.
      if (reason) {
        try {
          await enqueueCaptcha({
            jobId: vac.id, candidateId: cand.id,
            platform: vac.source, jobTitle: vac.title, company: emp.name,
            applicationUrl: applyUrl, matchScore: m.fitScore, blockedReason: reason,
            prefilledData: buildPrefillData(cand),
          });
        } catch { /* non-fatal */ }
      }

      // Log every scan (skip the noisy NO_FORM to keep the log actionable).
      if (status !== "NO_FORM") {
        await prisma.jobApplicationLog.upsert({
          where: { candidateId_vacancyId: { candidateId: cand.id, vacancyId: vac.id } },
          create: { candidateId: cand.id, vacancyId: vac.id, company: emp.name, position: vac.title, link: applyUrl, source: vac.source, status },
          update: { status, company: emp.name, position: vac.title, link: applyUrl, source: vac.source },
        });
      }
    }
  } finally {
    await browser.close();
  }
  return r;
}
