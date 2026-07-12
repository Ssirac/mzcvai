# MZ Autofill — Chrome Extension (Feature 2)

Füllt externe Bewerbungsformulare mit den Kandidatendaten aus der MZ-App aus.
**Rührt CAPTCHAs niemals an und sendet nie ab** — der Mensch bestätigt das CAPTCHA
selbst und drückt Absenden.

## Installation (unpacked)

1. Chrome → `chrome://extensions` → **Entwicklermodus** aktivieren.
2. **Entpackte Erweiterung laden** → diesen `extension/`-Ordner wählen.
3. Falls die MZ-App nicht unter `mzcvai-production.up.railway.app` oder
   `localhost:3000` läuft: `manifest.json` → `host_permissions` um deine URL
   ergänzen, dann in `chrome://extensions` neu laden.

## Einrichtung

1. In der **MZ-App einloggen** (das Session-Cookie authentifiziert die Extension —
   kein separater Token nötig; der Prefill-Endpunkt ist per Middleware geschützt).
2. Extension-Icon → Popup:
   - **MZ Basis-URL** eintragen (Standard: Railway-URL).
   - **Kandidaten laden** → Kandidat auswählen → **Speichern**.

## Nutzung

1. Externe Job-Seite (Bewerbungsformular) öffnen.
2. **CAPTCHA / Cloudflare selbst lösen** (die Extension tut das nie).
3. Unten rechts **„MZ: Daten ausfüllen"** klicken → Felder werden gefüllt und der
   Lebenslauf (falls hochgeladen) an das Datei-Feld gehängt.
4. Ergebnis prüfen, ggf. Restfelder manuell ergänzen, dann **selbst absenden**.
   (Alle Feldwerte liegen zusätzlich in der Zwischenablage als Fallback.)

## Feld-Zuordnung / Plattform-Overrides

Die Standard-Zuordnung deutscher Formularfelder steht in `selectors.js`
(`window.MZ_SELECTORS` / `window.MZ_FILE_MATCH`). Für eine Plattform mit
abweichenden Feldnamen die Einträge dort ergänzen (Name-/Label-Hinweise
hinzufügen) und die Extension neu laden.

## Grenzen

- Nicht-Standard-Widgets (React-Datepicker, custom File-Uploader, iFrames) lassen
  sich nicht immer befüllen — dann die kopierten Werte manuell einfügen.
- Die Extension überschreitet nie die Sicherheitsregeln: kein CAPTCHA-Lösen, kein
  Auto-Absenden, kein iFrame-Framing.
