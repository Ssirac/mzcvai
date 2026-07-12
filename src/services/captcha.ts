/**
 * Captcha queue service (Feature 1 — human-in-the-loop).
 *
 * When an automated external application hits a captcha / bot-wall, the flow must
 * NOT try to solve it. Instead it enqueues the application here (idempotently) so
 * an admin can open the direct link, clear the captcha by hand and finish it.
 *
 * HARD RULE: nothing in this file attempts to solve or bypass a captcha.
 */

import type { Page } from "puppeteer";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type BlockedReason = "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "cloudflare" | "captcha";

/**
 * Detect a captcha / bot-wall on a loaded page. Returns the reason string, or
 * null if none found. Reads rendered HTML + frame URLs (no page.evaluate closure,
 * which would hit the bundler `__name` issue) — purely observational, never
 * interacts with the challenge.
 */
export async function detectCaptcha(page: Page): Promise<BlockedReason | null> {
  let html = "";
  try {
    html = (await page.content()).toLowerCase();
  } catch {
    return null;
  }
  const frameUrls = page.frames().map((f) => f.url().toLowerCase());
  const inFrames = (s: string) => frameUrls.some((u) => u.includes(s));

  if (inFrames("challenges.cloudflare.com") || html.includes("cf-challenge") || html.includes("cf_chl_") || html.includes("checking your browser")) return "cloudflare";
  if (inFrames("hcaptcha.com") || html.includes("h-captcha") || html.includes('class="h-captcha"')) return "hcaptcha";
  if (inFrames("recaptcha") || html.includes("g-recaptcha") || html.includes("grecaptcha")) return "recaptcha_v2";
  if (html.includes("captcha")) return "captcha";
  return null;
}

// Fields an admin needs to complete an external application by hand — a PII
// snapshot taken at enqueue time so the queue row is self-contained.
export interface PrefillData {
  vorname: string;
  nachname: string;
  email: string | null;
  telefon: string | null;
  ort: string | null;
  beruf: string;
  deutschniveau: string | null;
  nationalitaet: string | null;
  [k: string]: string | null;
}

// Build the prefill snapshot from a candidate record.
export function buildPrefillData(c: {
  name: string; email: string | null; phone: string | null; currentCity: string | null;
  beruf: string; germanLevel: string | null; nationality: string | null;
}): PrefillData {
  const parts = c.name.trim().split(/\s+/);
  const vorname = parts[0] ?? "";
  const nachname = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    vorname,
    nachname,
    email: c.email,
    telefon: c.phone,
    ort: c.currentCity,
    beruf: c.beruf,
    deutschniveau: c.germanLevel,
    nationalitaet: c.nationality,
  };
}

export interface EnqueueParams {
  jobId: string;
  candidateId: string;
  platform: string;
  jobTitle: string;
  company: string;
  applicationUrl: string;
  matchScore: number;
  blockedReason: string;
  prefilledData: PrefillData | Prisma.InputJsonValue;
}

/**
 * Enqueue (or refresh) a captcha-blocked application. Idempotent on the unique
 * (jobId, candidateId): a re-run updates the details but never duplicates the row
 * and never resets an already-resolved status back to PENDING.
 */
export async function enqueueCaptcha(p: EnqueueParams): Promise<string> {
  const row = await prisma.captchaQueue.upsert({
    where: { jobId_candidateId: { jobId: p.jobId, candidateId: p.candidateId } },
    create: {
      jobId: p.jobId,
      candidateId: p.candidateId,
      platform: p.platform,
      jobTitle: p.jobTitle,
      company: p.company,
      applicationUrl: p.applicationUrl,
      matchScore: p.matchScore,
      blockedReason: p.blockedReason,
      prefilledData: p.prefilledData as Prisma.InputJsonValue,
      status: "PENDING",
    },
    update: {
      // Refresh details (a later run may have a better link / reason) but DO NOT
      // touch `status` — a SUBMITTED/SKIPPED row stays resolved.
      platform: p.platform,
      jobTitle: p.jobTitle,
      company: p.company,
      applicationUrl: p.applicationUrl,
      matchScore: p.matchScore,
      blockedReason: p.blockedReason,
      prefilledData: p.prefilledData as Prisma.InputJsonValue,
    },
  });
  return row.id;
}
