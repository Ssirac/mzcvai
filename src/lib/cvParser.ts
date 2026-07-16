import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, extractText } from "@/lib/anthropic";

// Shared extraction instruction used for both PDF and pasted-text CVs.
export const CV_INSTRUCTION = `Du bekommst einen Lebenslauf (CV). Extrahiere die Kandidatendaten und gib AUSSCHLIESSLICH ein gültiges JSON-Objekt zurück (kein Markdown, keine Erklärung), exakt mit diesen Feldern:

{
  "name": string,
  "email": string,
  "phone": string,
  "dateOfBirth": "YYYY-MM-DD" oder "",
  "gender": "male" | "female" | "other" | "",
  "nationality": string,
  "maritalStatus": "single" | "married" | "",
  "currentCity": string,
  "currentCountry": string,
  "address": string,
  "beruf": string,                // Hauptberuf/Qualifikation, z.B. "Koch", "Druckerei/Polygrafie", "Softwareentwickler"
  "desiredPosition": string,
  "yearsExperience": number,      // geschätzte Gesamtjahre, 0 wenn unbekannt
  "germanLevel": "A1"|"A2"|"B1"|"B2"|"C1"|"C2"|"Muttersprache"|"",
  "otherLanguages": string[],     // nur Codes aus: az,en,ru,tr,ar,uk,fa
  "visaStatus": string,
  "salaryExpectation": string,
  "drivingLicense": string,
  "skills": string[],
  "certificates": string[],
  "experience": [ { "company": string, "title": string, "from": string, "to": string, "description": string } ],
  "education": [ { "school": string, "degree": string, "field": string, "from": string, "to": string } ],
  "notes": string
}

Regeln (WICHTIG — vollständig extrahieren):
- Lies den GESAMTEN Lebenslauf, ALLE Seiten und ALLE Abschnitte. Lasse NICHTS aus.
- Übernimm JEDE Berufserfahrung als eigenen experience-Eintrag (nicht zusammenfassen, wenn mehrere Stationen mit Firma/Datum vorhanden sind).
- Übernimm JEDE Ausbildung/Schule/Studium als eigenen education-Eintrag.
- Extrahiere ALLE genannten Fähigkeiten, Computerkenntnisse und Software in "skills".
- Extrahiere ALLE Zertifikate, Lizenzen, Kurse in "certificates".
- "notes": fasse Profil/Zusammenfassung sowie zusätzliche Infos (Verfügbarkeit, Umzugsbereitschaft, Schichtbereitschaft) hier zusammen.
- Sprachen: Deutsch-Niveau → "germanLevel"; alle ANDEREN Sprachen als Codes in "otherLanguages".
- Daten exakt aus dem CV übernehmen, NICHTS erfinden. Nur wirklich fehlende Felder leer ("" / [] / 0) lassen.
- "from"/"to" als Jahr (z.B. "2019") oder Monat/Jahr.
- Wenn Berufserfahrung NUR als Fließtext ohne Firmennamen vorliegt, fasse sie in EINEM experience-Eintrag zusammen (company = "", title = Hauptberuf, description = die Tätigkeiten).
- Antworte mit dem reinen JSON-Objekt, ohne Kommentare.`;

// Pull the JSON object out of the model's reply.
export function extractCvJson(text: string): Record<string, unknown> | null {
  const jsonStr = text.replace(/```json\s*|\s*```/g, "").trim();
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(jsonStr.slice(start, end + 1));
  } catch {
    return null;
  }
}

type ContentBlocks = Anthropic.Messages.MessageParam["content"];

// Run Claude on arbitrary content blocks (PDF document or plain text) and
// return the extracted candidate fields.
export async function parseCvContent(content: ContentBlocks): Promise<Record<string, unknown>> {
  const message = await anthropic.messages.create({
    model: "claude-opus-4-8", // strongest model — most complete/accurate CV extraction → better matches
    max_tokens: 4000, // longer CVs need room for full experience/education lists
    messages: [{ role: "user", content }],
  });
  // All text blocks — content[0] may be a thinking block on newer models.
  const text = extractText(message);
  const parsed = extractCvJson(text);
  if (!parsed) throw new Error("Could not parse CV");
  return parsed;
}
