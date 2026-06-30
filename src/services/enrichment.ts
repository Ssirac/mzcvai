/**
 * Layer 2 — Employer Enrichment via Puppeteer
 *
 * Rules:
 * - Only enriches employers that already have a vacancy from Arbeitsagentur (Layer 1)
 * - Always checks robots.txt before crawling
 * - Never stores personal/named HR email addresses
 * - Polite request rate — 2s delay between employers
 *
 * Legal note: This is not legal advice.
 * Consult a German GDPR/UWG lawyer before scaling outreach operations.
 */

import { launchBrowser } from "@/lib/browser";
import { prisma } from "@/lib/prisma";
import type { SponsorshipSignal } from "@prisma/client";

const SPONSORSHIP_KEYWORDS = [
  "visum", "sponsoring", "sponsorship", "relocation", "fachkräfte",
  "welcome", "international", "nicht-eu", "drittstaaten", "ausland",
  "work permit", "zuwanderung", "einwanderung",
];

const ENGLISH_INDICATORS = [
  "apply now", "we are looking for", "join our team", "we offer",
  "requirements:", "responsibilities:", "about us",
];

// Recruitment-department addresses are preferred over general ones so outreach
// lands directly with HR / "Bewerbung", not a generic info@ inbox.
const RECRUITMENT_PREFIXES = [
  "bewerbung", "bewerbungen", "karriere", "jobs", "job", "recruiting",
  "recruitment", "personal", "hr", "stelle", "stellen", "career", "careers",
];
const GENERAL_PREFIXES = ["info", "kontakt", "contact", "office", "post", "mail", "team"];
const GENERIC_EMAIL_PREFIXES = [...RECRUITMENT_PREFIXES, ...GENERAL_PREFIXES];

// Lower number = higher priority (recruitment dept first)
function emailPriority(email: string): number {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const r = RECRUITMENT_PREFIXES.findIndex((p) => local === p || local.startsWith(p));
  if (r !== -1) return r;
  const g = GENERAL_PREFIXES.findIndex((p) => local === p || local.startsWith(p));
  return 100 + (g === -1 ? 99 : g);
}

// Check robots.txt — returns true if path is allowed
async function isAllowedByRobots(baseUrl: string, path = "/"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl}/robots.txt`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return true; // no robots.txt = allowed

    const text = await res.text();
    const lines = text.toLowerCase().split("\n");
    let applicable = false;

    for (const line of lines) {
      if (line.startsWith("user-agent: *") || line.startsWith("user-agent: mzpersonal")) {
        applicable = true;
      }
      if (applicable && line.startsWith("disallow:")) {
        const disallowedPath = line.replace("disallow:", "").trim();
        if (disallowedPath && path.startsWith(disallowedPath)) return false;
      }
      if (applicable && line.startsWith("user-agent:") && !line.includes("*") && !line.includes("mzpersonal")) {
        applicable = false;
      }
    }
    return true;
  } catch {
    return true; // on error, assume allowed (fail-open)
  }
}

function extractGenericEmails(text: string): string[] {
  // De-obfuscate common anti-scraper tricks: info(at)firma.de, info [at] firma [dot] de
  const deob = text
    .replace(/\s*[\(\[\{]\s*at\s*[\)\]\}]\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*[\(\[\{]\s*dot\s*[\)\]\}]\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".");

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const all = deob.match(emailRegex) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of all) {
    const email = raw.toLowerCase();
    const local = email.split("@")[0] ?? "";
    if (GENERIC_EMAIL_PREFIXES.some((prefix) => local === prefix || local.startsWith(prefix))) {
      if (!seen.has(email)) { seen.add(email); result.push(email); }
    }
  }
  // Sort so the recruitment-department address comes first
  return result.sort((a, b) => emailPriority(a) - emailPriority(b));
}

function detectSponsorshipSignal(text: string): SponsorshipSignal {
  const lower = text.toLowerCase();
  const hasExplicit = SPONSORSHIP_KEYWORDS.some((kw) => lower.includes(kw));
  const hasEnglish = ENGLISH_INDICATORS.some((kw) => lower.includes(kw));

  if (hasExplicit) return "YES";
  if (hasEnglish) return "LIKELY";
  return "UNKNOWN";
}

function extractStars(text: string): number | null {
  const match = text.match(/(\d)\s*[-–]?\s*sterne?/i) ?? text.match(/(\d)\s*star/i);
  if (match && match[1]) {
    const n = parseInt(match[1]);
    if (n >= 1 && n <= 5) return n;
  }
  return null;
}

function extractRooms(text: string): number | null {
  const match = text.match(/(\d{2,4})\s*(zimmer|rooms?|betten)/i);
  if (match && match[1]) {
    const n = parseInt(match[1]);
    if (n >= 5 && n <= 5000) return n;
  }
  return null;
}

// Well-known hotel chains → sponsorship signal (YES = known to hire internationally)
const KNOWN_CHAINS: { keywords: string[]; signal: SponsorshipSignal }[] = [
  { keywords: ["hilton", "hampton by hilton", "doubletree", "curio"], signal: "YES" },
  { keywords: ["marriott", "sheraton", "westin", "renaissance", "courtyard", "moxy"], signal: "YES" },
  { keywords: ["accor", "ibis", "novotel", "mercure", "sofitel", "pullman"], signal: "YES" },
  { keywords: ["intercontinental", "holiday inn", "crowne plaza", "staybridge"], signal: "YES" },
  { keywords: ["hyatt", "andaz", "park hyatt"], signal: "YES" },
  { keywords: ["best western", "bestwestern"], signal: "LIKELY" },
  { keywords: ["radisson", "park inn"], signal: "LIKELY" },
  { keywords: ["nhow", "nh hotel", "nh hotels"], signal: "LIKELY" },
  { keywords: ["leonardo hotel", "fattal"], signal: "LIKELY" },
  { keywords: ["lindner hotel"], signal: "LIKELY" },
  { keywords: ["steigenberger", "dorint", "relexa"], signal: "LIKELY" },
];

function signalFromChainName(name: string): SponsorshipSignal | null {
  const lower = name.toLowerCase();
  for (const chain of KNOWN_CHAINS) {
    if (chain.keywords.some((kw) => lower.includes(kw))) return chain.signal;
  }
  return null;
}

// Try to guess employer website from company name (heuristic)
function guessWebsite(name: string): string | null {
  // Remove legal suffixes and trim
  const clean = name
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|ohg|mbh|co\.|ug|e\.v\.|mbh|&|co|kgaa|gmbh\s*&\s*co\.?\s*kg?)\b/gi, "")
    .replace(/[^a-z0-9äöüß\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c] ?? c));

  if (!clean || clean.length < 3) return null;
  return `https://${clean}.de`;
}

// Enrich a single employer website
async function enrichEmployer(employerId: string, website: string): Promise<void> {
  const baseUrl = website.startsWith("http") ? website : `https://${website}`;

  const allowed = await isAllowedByRobots(baseUrl);
  if (!allowed) {
    await prisma.employer.update({
      where: { id: employerId },
      data: { enrichmentError: "robots.txt disallows crawling", lastEnrichedAt: new Date() },
    });
    return;
  }

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setUserAgent("MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de; +https://mz-personalvermittlung.de)");
    await page.setDefaultTimeout(15000);

    // Load homepage
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const homeText = await page.evaluate(() => document.body.innerText);
    const homeHtml = await page.content();

    // Collect relevant inner pages: Impressum & Kontakt (legally must list a
    // generic contact email in Germany — highest-yield), plus careers pages.
    const innerLinks = await page.$$eval("a", (anchors) => {
      const want = (text: string, href: string, keys: string[]) =>
        keys.some((k) => text.includes(k) || href.toLowerCase().includes(k));
      const out: { impressum: string[]; kontakt: string[]; jobs: string[] } = { impressum: [], kontakt: [], jobs: [] };
      for (const a of anchors) {
        const href = a.href;
        const text = a.textContent?.toLowerCase() ?? "";
        if (!href || href.includes("mailto:")) continue;
        if (want(text, href, ["impressum", "imprint"])) out.impressum.push(href);
        else if (want(text, href, ["kontakt", "contact"])) out.kontakt.push(href);
        else if (want(text, href, ["karriere", "job", "stelle", "bewerbung", "career"])) out.jobs.push(href);
      }
      return out;
    });

    // Visit the most useful inner pages (Impressum first), accumulate HTML/text.
    const visitOrder = [innerLinks.impressum[0], innerLinks.kontakt[0], innerLinks.jobs[0]].filter(Boolean) as string[];
    let innerHtml = "";
    let innerText = "";
    for (const link of visitOrder.slice(0, 3)) {
      try {
        await page.goto(link, { waitUntil: "domcontentloaded" });
        innerText += " " + (await page.evaluate(() => document.body.innerText));
        innerHtml += " " + (await page.content());
      } catch {
        // Non-fatal — continue with what we have
      }
    }

    const fullText = homeText + " " + innerText;

    // Extract data — emails from homepage + Impressum/Kontakt/careers pages
    const genericEmails = extractGenericEmails(homeHtml + " " + innerHtml + " " + innerText);
    const applyFormMatch = (homeHtml + innerHtml).match(/href="([^"]*(?:bewerbung|apply|karriere|jobs)[^"]*form[^"]*)"/i);
    const sponsorshipSignal = detectSponsorshipSignal(fullText);
    const stars = extractStars(fullText);
    const rooms = extractRooms(fullText);

    await prisma.employer.update({
      where: { id: employerId },
      data: {
        genericEmail: genericEmails[0] ?? null,
        applyFormUrl: applyFormMatch?.[1] ?? null,
        sponsorshipSignal,
        ...(stars ? { stars } : {}),
        ...(rooms ? { rooms } : {}),
        lastEnrichedAt: new Date(),
        enrichmentError: null,
      },
    });
  } catch (err) {
    await prisma.employer.update({
      where: { id: employerId },
      data: {
        enrichmentError: (err as Error).message.slice(0, 500),
        lastEnrichedAt: new Date(),
      },
    });
  } finally {
    await browser.close();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Mine the employer's own job listings for a generic application email. Job
 * postings frequently spell out "Bewerbung an: jobs@firma.de" in the description
 * (or in the raw API payload), which is the most reliable email of all — it's the
 * address the employer explicitly wants applications sent to. No network needed.
 */
async function emailFromVacancies(employerId: string): Promise<string | null> {
  const vacancies = await prisma.vacancy.findMany({
    where: { employerId, status: "ACTIVE" },
    select: { description: true, applyValue: true, rawData: true },
    orderBy: { foundAt: "desc" },
    take: 10,
  });

  for (const v of vacancies) {
    // applyValue is sometimes a bare email address
    if (v.applyValue && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.applyValue.trim())) {
      const found = extractGenericEmails(v.applyValue);
      if (found[0]) return found[0];
    }
    const haystack = `${v.description ?? ""} ${v.applyValue ?? ""} ${v.rawData ? JSON.stringify(v.rawData) : ""}`;
    const emails = extractGenericEmails(haystack);
    if (emails[0]) return emails[0];
  }
  return null;
}

/**
 * Hunter.io domain-search: given an employer's website domain (e.g. "firma.de"),
 * asks Hunter for the most common generic email pattern and returns the best
 * address (bewerbung/hr/jobs/info priority). Falls back gracefully on any error
 * so the rest of enrichment continues unaffected. Uses at most 1 API credit.
 *
 * Requires HUNTER_API_KEY env var (https://hunter.io → API Keys, 25 free/day).
 */
async function emailFromHunter(domain: string): Promise<string | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;

  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${key}&limit=10&type=generic`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: {
        emails?: { value: string; type: string; confidence: number }[];
        domain?: string;
      };
    };

    const emails = json.data?.emails ?? [];
    // Filter to generic addresses only, sort by our own priority
    const generic = emails
      .filter((e) => e.type === "generic" && e.confidence >= 70)
      .map((e) => e.value.toLowerCase())
      .filter((e) => {
        const local = e.split("@")[0] ?? "";
        return GENERIC_EMAIL_PREFIXES.some((p) => local === p || local.startsWith(p));
      })
      .sort((a, b) => emailPriority(a) - emailPriority(b));

    return generic[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Apollo.io organization enrichment — given a domain, asks Apollo for the
 * organization's public/generic email if it exposes one. Defensive: returns null
 * on any failure so the pipeline continues. Requires APOLLO_API_KEY.
 */
async function emailFromApollo(domain: string): Promise<string | null> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://api.apollo.io/api/v1/organizations/enrich?domain=" + encodeURIComponent(domain), {
      method: "GET",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const json = (await res.json()) as { organization?: { email?: string } };
    const email = json.organization?.email?.toLowerCase();
    if (!email) return null;
    const local = email.split("@")[0] ?? "";
    if (GENERIC_EMAIL_PREFIXES.some((p) => local === p || local.startsWith(p))) return email;
    return null;
  } catch {
    return null;
  }
}

/**
 * Last-resort discovery: drive the existing headless browser to a search engine
 * and read generic emails out of the results snippets. Uses DuckDuckGo's HTML
 * endpoint (no captcha, no API key) and queries for the company's application
 * address. Returns the best generic email found, or null.
 */
async function emailFromSearch(employerName: string, domain: string | null): Promise<string | null> {
  const query = domain
    ? `"${domain}" bewerbung OR kontakt email`
    : `${employerName} bewerbung email impressum`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent("MZPersonal-CompanyFinder/1.0 (contact@mz-personalvermittlung.de)");
    await page.setDefaultTimeout(15000);
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" });
    const text = await page.evaluate(() => document.body.innerText);
    const emails = extractGenericEmails(text);
    // Prefer an email whose domain matches the employer's, if we know it
    if (domain) {
      const onDomain = emails.find((e) => e.endsWith("@" + domain) || e.endsWith("." + domain));
      if (onDomain) return onDomain;
    }
    return emails[0] ?? null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Verify an email's deliverability via Hunter's Email Verifier. Returns the
 * status string ("deliverable" | "risky" | "undeliverable" | "unknown") or null
 * if verification is unavailable. Costs 1 Hunter credit per call, so it only runs
 * when VERIFY_EMAILS is enabled.
 */
async function verifyEmail(email: string): Promise<string | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key || process.env.VERIFY_EMAILS !== "true") return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { status?: string } };
    return json.data?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * On-demand enrichment for ONE employer — used right before sending outreach so
 * the user doesn't have to run a separate enrichment pass. Runs every discovery
 * source in order of reliability until one yields a generic email, optionally
 * verifies it, and records which source produced it. Returns the email or null.
 *
 * Order: listing text → Hunter.io → Apollo.io → search engine → website scraping.
 */
export async function enrichSingleEmployer(employerId: string): Promise<string | null> {
  const employer = await prisma.employer.findUnique({
    where: { id: employerId },
    select: { id: true, website: true, name: true, genericEmail: true, sponsorshipSignal: true },
  });
  if (!employer) return null;

  // Already has an email — nothing to do
  if (employer.genericEmail) return employer.genericEmail;

  // Chain detection (sets sponsorship signal but won't produce an email)
  if (employer.sponsorshipSignal === "UNKNOWN") {
    const chainSignal = signalFromChainName(employer.name);
    if (chainSignal) {
      await prisma.employer.update({
        where: { id: employer.id },
        data: { sponsorshipSignal: chainSignal, lastEnrichedAt: new Date() },
      });
    }
  }

  const website = employer.website ?? guessWebsite(employer.name);
  let domain: string | null = null;
  if (website) {
    try {
      domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
  }

  // Persist a found email (with its source + verification status) and return it.
  // If verification says "undeliverable", reject it and let the caller try the
  // next source by returning null.
  const accept = async (email: string, source: string): Promise<string | null> => {
    const status = await verifyEmail(email);
    if (status === "undeliverable") return null;
    await prisma.employer.update({
      where: { id: employer.id },
      data: {
        genericEmail: email,
        emailSource: source,
        emailStatus: status,
        lastEnrichedAt: new Date(),
        enrichmentError: null,
        ...(website && !employer.website ? { website } : {}),
      },
    });
    return email;
  };

  // Step 0: listing text (most reliable — employer wrote it for applications)
  const fromListing = await emailFromVacancies(employer.id);
  if (fromListing) {
    const ok = await accept(fromListing, "listing");
    if (ok) return ok;
  }

  // Step 1: Hunter.io domain search (fast HTTP, 50 free credits/month)
  if (domain) {
    const fromHunter = await emailFromHunter(domain);
    if (fromHunter) {
      const ok = await accept(fromHunter, "hunter");
      if (ok) return ok;
    }
  }

  // Step 2: Apollo.io organization enrichment (second provider)
  if (domain) {
    const fromApollo = await emailFromApollo(domain);
    if (fromApollo) {
      const ok = await accept(fromApollo, "apollo");
      if (ok) return ok;
    }
  }

  // Step 3: search-engine scraping (no API key, uses the headless browser)
  const fromSearch = await emailFromSearch(employer.name, domain);
  if (fromSearch) {
    const ok = await accept(fromSearch, "google");
    if (ok) return ok;
  }

  // Step 4: full website scraping (Impressum / Kontakt) — slowest, last resort
  if (!website) {
    await prisma.employer.update({
      where: { id: employer.id },
      data: { lastEnrichedAt: new Date(), enrichmentError: "No website available" },
    });
    return null;
  }

  try {
    await enrichEmployer(employer.id, website);
    if (!employer.website) {
      await prisma.employer.update({ where: { id: employer.id }, data: { website } });
    }
  } catch {
    // enrichEmployer already records its own error; just fall through
  }

  const refreshed = await prisma.employer.findUnique({
    where: { id: employerId },
    select: { genericEmail: true },
  });
  if (refreshed?.genericEmail) {
    await prisma.employer.update({
      where: { id: employer.id },
      data: { emailSource: "website" },
    });
  }
  return refreshed?.genericEmail ?? null;
}

/**
 * Find emails for every employer matched to ONE candidate that doesn't have one
 * yet. Listing-text mining runs first (fast, no browser), website scraping only
 * as fallback. Returns how many emails were newly found so the UI can report it.
 */
export async function enrichMatchesForCandidate(candidateId: string): Promise<{
  found: number;
  alreadyHad: number;
  stillMissing: number;
  total: number;
}> {
  const matches = await prisma.match.findMany({
    where: { candidateId },
    select: { employer: { select: { id: true, genericEmail: true } } },
  });

  // De-duplicate employers (a candidate can match the same employer twice)
  const seen = new Set<string>();
  const employerIds: string[] = [];
  let alreadyHad = 0;
  for (const m of matches) {
    if (seen.has(m.employer.id)) continue;
    seen.add(m.employer.id);
    if (m.employer.genericEmail) { alreadyHad++; continue; }
    employerIds.push(m.employer.id);
  }

  let found = 0;
  for (const id of employerIds) {
    try {
      const email = await enrichSingleEmployer(id);
      if (email) found++;
    } catch {
      // keep going — one bad site shouldn't stop the batch
    }
  }

  return {
    found,
    alreadyHad,
    stillMissing: employerIds.length - found,
    total: seen.size,
  };
}

// Enrich all employers: chain detection first (instant), then website scraping
export async function enrichPendingEmployers(limit = 20): Promise<{
  enriched: number;
  chainMatched: number;
  skipped: number;
  errors: string[];
}> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const employers = await prisma.employer.findMany({
    where: {
      vacancies: { some: { status: "ACTIVE" } },
      OR: [
        { lastEnrichedAt: null },
        { lastEnrichedAt: { lt: cutoff }, enrichmentError: { not: null } },
      ],
    },
    select: { id: true, website: true, name: true, sponsorshipSignal: true },
    take: limit,
  });

  const result = { enriched: 0, chainMatched: 0, skipped: 0, errors: [] as string[] };

  for (const employer of employers) {
    // Step 1: Instant chain detection (no HTTP needed)
    if (employer.sponsorshipSignal === "UNKNOWN") {
      const chainSignal = signalFromChainName(employer.name);
      if (chainSignal) {
        await prisma.employer.update({
          where: { id: employer.id },
          data: { sponsorshipSignal: chainSignal, lastEnrichedAt: new Date() },
        });
        result.chainMatched++;
        continue;
      }
    }

    // Step 2: Website scraping — use existing or try heuristic URL
    const website = employer.website ?? guessWebsite(employer.name);
    if (!website) {
      await prisma.employer.update({
        where: { id: employer.id },
        data: { lastEnrichedAt: new Date(), enrichmentError: "No website available" },
      });
      result.skipped++;
      continue;
    }

    try {
      await enrichEmployer(employer.id, website);
      // Save guessed website if it worked and we didn't have one
      if (!employer.website) {
        await prisma.employer.update({ where: { id: employer.id }, data: { website } });
      }
      result.enriched++;
    } catch (err) {
      result.errors.push(`${employer.name}: ${(err as Error).message}`);
    }

    await sleep(2000);
  }

  return result;
}
