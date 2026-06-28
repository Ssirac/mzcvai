/**
 * Generates a clean German "Lebenslauf" PDF from a candidate's stored data,
 * for attaching to outreach emails. Uses Puppeteer (HTML → PDF).
 */

import { launchBrowser } from "@/lib/browser";
import type { Candidate } from "@prisma/client";

interface ExperienceRow { company?: string; title?: string; from?: string; to?: string; description?: string }
interface EducationRow { school?: string; degree?: string; field?: string; from?: string; to?: string }

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function renderCvHtml(c: Candidate): string {
  const experience = asArray<ExperienceRow>(c.experience);
  const education = asArray<EducationRow>(c.education);
  const langs = (c.languages ?? []).join(", ");
  const skills = (c.skills ?? []);
  const certs = (c.certificates ?? []);

  const row = (label: string, value: string) =>
    value ? `<tr><td class="lbl">${esc(label)}</td><td>${esc(value)}</td></tr>` : "";

  const expHtml = experience
    .filter((e) => e.title || e.company || e.description)
    .map(
      (e) => `<div class="item">
        <div class="item-head">
          <span class="item-title">${esc(e.title || "")}${e.company ? " · " + esc(e.company) : ""}</span>
          <span class="item-date">${esc([e.from, e.to].filter(Boolean).join(" – "))}</span>
        </div>
        ${e.description ? `<div class="item-desc">${esc(e.description)}</div>` : ""}
      </div>`
    )
    .join("");

  const eduHtml = education
    .filter((e) => e.school || e.degree)
    .map(
      (e) => `<div class="item">
        <div class="item-head">
          <span class="item-title">${esc(e.degree || "")}${e.field ? ", " + esc(e.field) : ""}${e.school ? " · " + esc(e.school) : ""}</span>
          <span class="item-date">${esc([e.from, e.to].filter(Boolean).join(" – "))}</span>
        </div>
      </div>`
    )
    .join("");

  const chips = (arr: string[]) =>
    arr.map((s) => `<span class="chip">${esc(s)}</span>`).join("");

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; line-height: 1.5; margin: 0; }
  .header { background: #0f766e; color: #fff; padding: 28px 36px; }
  .name { font-size: 24px; font-weight: 700; margin: 0; }
  .role { font-size: 13px; opacity: .9; margin-top: 2px; }
  .contact { font-size: 11px; opacity: .9; margin-top: 10px; }
  .body { padding: 24px 36px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #0f766e; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; margin: 20px 0 10px; }
  table.info { width: 100%; border-collapse: collapse; }
  table.info td { padding: 2px 0; vertical-align: top; }
  td.lbl { width: 150px; color: #6b7280; }
  .item { margin-bottom: 10px; }
  .item-head { display: flex; justify-content: space-between; gap: 12px; }
  .item-title { font-weight: 600; }
  .item-date { color: #6b7280; white-space: nowrap; font-size: 11px; }
  .item-desc { color: #374151; margin-top: 2px; }
  .chip { display: inline-block; background: #f0fdfa; color: #115e59; border: 1px solid #99f6e4; border-radius: 6px; padding: 2px 8px; margin: 0 4px 4px 0; font-size: 11px; }
  .profile { color: #374151; }
  </style></head><body>
    <div class="header">
      <h1 class="name">${esc(c.name)}</h1>
      <div class="role">${esc(c.desiredPosition || c.beruf || "")}</div>
      <div class="contact">${[c.email, c.phone, c.currentCity, c.currentCountry].filter(Boolean).map(esc).join("  ·  ")}</div>
    </div>
    <div class="body">
      ${c.notes ? `<div class="profile">${esc(c.notes)}</div>` : ""}

      <h2>Persönliche Daten</h2>
      <table class="info">
        ${row("Geburtsdatum", fmtDate(c.dateOfBirth))}
        ${row("Staatsangehörigkeit", c.nationality || "")}
        ${row("Adresse", c.address || "")}
        ${row("Familienstand", c.maritalStatus === "married" ? "Verheiratet" : c.maritalStatus === "single" ? "Ledig" : "")}
        ${row("Führerschein", c.drivingLicense || "")}
        ${row("Verfügbar ab", fmtDate(c.availableFrom))}
        ${row("Visum/Status", c.visaStatus || "")}
      </table>

      ${expHtml ? `<h2>Berufserfahrung</h2>${expHtml}` : ""}
      ${eduHtml ? `<h2>Ausbildung</h2>${eduHtml}` : ""}
      ${langs ? `<h2>Sprachen</h2><div>${esc(langs)}</div>` : ""}
      ${skills.length ? `<h2>Fähigkeiten</h2><div>${chips(skills)}</div>` : ""}
      ${certs.length ? `<h2>Zertifikate</h2><div>${chips(certs)}</div>` : ""}
    </div>
  </body></html>`;
}

export async function generateCandidateCvPdf(candidate: Candidate): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderCvHtml(candidate), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "16px", left: "0", right: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// Safe filename like "Lebenslauf_Iman_Azizov.pdf"
export function cvFileName(name: string): string {
  const clean = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `Lebenslauf_${clean || "Kandidat"}.pdf`;
}
