/**
 * LLM form classifier + field mapper for the auto-apply engine.
 *
 * Two jobs, one cheap Haiku call:
 *   1. Classify — is this actually a job APPLICATION form, or a search / filter /
 *      newsletter / login form the static ">=2 inputs" heuristic mistook for one?
 *   2. Map — for each REQUIRED field the static substring matcher could not fill,
 *      pick the best candidate data key (or none, for free-text/motivation fields
 *      a human must write).
 *
 * GDPR: only form STRUCTURE (labels, field names, option texts) and the LIST of
 * candidate field KEYS are sent to the model — never any candidate value. The
 * mapping comes back as marker→key; the engine fills the actual PII locally.
 *
 * Fail-soft: any error / unparseable reply returns null so the engine falls back
 * to its static result (and routes to a human when required fields remain).
 */

import { anthropic, extractText } from "@/lib/anthropic";
import type { UnmatchedField } from "@/lib/formFill";

export interface FormClassification {
  isApplicationForm: boolean;
  confidence: number;                 // 0..1
  mapping: Record<string, string>;    // marker -> candidateKey (∈ availableKeys)
}

// Short German hints so the model knows what each candidate key holds.
const KEY_HINTS: Record<string, string> = {
  vorname: "Vorname", nachname: "Nachname", name: "vollständiger Name",
  email: "E-Mail-Adresse", telefon: "Telefonnummer", geburtsdatum: "Geburtsdatum",
  starttermin: "frühester Starttermin", nationalitaet: "Nationalität", adresse: "Adresse/Straße",
  anstellungsort: "gewünschter Arbeitsort", ort: "aktueller Wohnort", land: "Land",
  beruf: "Beruf/Position", berufserfahrung: "Jahre Berufserfahrung",
  deutschniveau: "Deutschkenntnisse (CEFR)", englischniveau: "Englischkenntnisse (CEFR)",
  gehaltswunsch: "Gehaltswunsch", aufenthaltstitel: "Aufenthaltstitel/Arbeitserlaubnis",
  arbeitserlaubnis: "Arbeitserlaubnis", fuehrerschein: "Führerschein",
};

function stripFence(s: string): string {
  return s.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

export async function classifyAndMapForm(input: {
  jobTitle: string;
  filledKeys: string[];
  unmatched: UnmatchedField[];
  availableKeys: string[];
}): Promise<FormClassification | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const keyList = input.availableKeys
    .map((k) => `- ${k}${KEY_HINTS[k] ? ` (${KEY_HINTS[k]})` : ""}`)
    .join("\n");
  const unmatchedList = input.unmatched
    .map((u) => `  { "marker": "${u.marker}", "label": ${JSON.stringify(u.label)}, "type": "${u.type}"${u.options && u.options.length ? `, "options": ${JSON.stringify(u.options.slice(0, 20))}` : ""} }`)
    .join("\n");

  const prompt = `Du prüfst ein deutsches Web-Formular für eine Stellenbewerbung (Stelle: "${input.jobTitle}").
Es enthält bereits Felder, die automatisch befüllt wurden (Schlüssel: ${input.filledKeys.join(", ") || "keine"}).

AUFGABE 1 — Klassifizieren: Ist dies WIRKLICH ein Bewerbungsformular (Name/E-Mail/Anschreiben/Lebenslauf), oder etwas anderes (Job-Suche, Filter, Newsletter, Login)? Gib isApplicationForm (true/false) und confidence (0..1).

AUFGABE 2 — Zuordnen: Ordne jedem der folgenden PFLICHTFELDER, die noch leer sind, den PASSENDEN Kandidaten-Schlüssel zu. Nur aus dieser Liste wählen:
${keyList}
Wenn KEIN Schlüssel passt (z. B. ein Freitext-Motivationsschreiben, eine Frage, die nur ein Mensch beantworten kann), lasse den Wert leer ("").

PFLICHTFELDER (JSON):
[
${unmatchedList}
]

Antworte AUSSCHLIESSLICH mit reinem JSON, ohne Erklärung, in genau dieser Form:
{"isApplicationForm": true, "confidence": 0.9, "mapping": {"<marker>": "<schlüssel oder leer>"}}`;

  try {
    const message = await anthropic.messages.create({
      model: process.env.FORM_CLASSIFIER_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = JSON.parse(stripFence(extractText(message))) as {
      isApplicationForm?: unknown; confidence?: unknown; mapping?: unknown;
    };

    const validMarkers = new Set(input.unmatched.map((u) => u.marker));
    const validKeys = new Set(input.availableKeys);
    const mapping: Record<string, string> = {};
    if (parsed.mapping && typeof parsed.mapping === "object") {
      for (const [marker, key] of Object.entries(parsed.mapping as Record<string, unknown>)) {
        if (validMarkers.has(marker) && typeof key === "string" && key && validKeys.has(key)) {
          mapping[marker] = key;
        }
      }
    }
    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    return { isApplicationForm: parsed.isApplicationForm !== false, confidence, mapping };
  } catch {
    return null;
  }
}
