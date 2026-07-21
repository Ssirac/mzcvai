/**
 * Server-side form filling for the auto-apply engine.
 *
 * This ports the browser-side field-mapping intelligence from the MZ Autofill
 * extension (extension/selectors.js + extension/content.js) so a headless
 * Puppeteer page can fill a German application form the same way a human's
 * extension would — then REPORT what it filled and, critically, which REQUIRED
 * fields it could NOT fill. The auto-apply engine refuses to submit when any
 * required field is still empty, so a half-mapped form is never sent.
 *
 * Why a string, not a function: this codebase's Next bundler rewrites closures
 * passed to page.evaluate (the `__name` helper) and they crash in the browser
 * context. Passing plain JS as a STRING (and calling it with JSON-inlined data)
 * sidesteps the transform entirely — the same reason the scrapers use cheerio in
 * Node instead of page.$$eval.
 *
 * HARD LINE: nothing here clicks submit or touches a captcha. Filling and
 * submission are separate steps in the engine, and submission only ever runs on
 * a form with no captcha/OTP/login and no missing required fields.
 */

// The field → matcher map, mirrored from extension/selectors.js. Kept as plain
// data so it can be JSON-inlined into the page script.
export const FORM_SELECTORS: Record<string, {
  names?: string[]; labels?: string[]; types?: string[];
  select?: boolean; nat?: boolean; level?: boolean; radio?: boolean; checkbox?: boolean;
}> = {
  anrede:        { names: ["anrede", "salutation", "title"], labels: ["Anrede", "Salutation"], select: true },
  geschlecht:    { names: ["geschlecht", "gender", "sex"], labels: ["Geschlecht", "Gender", "Sex"] },
  vorname:       { names: ["vorname", "firstname", "first_name", "given-name", "fname"], labels: ["Vorname", "First name"] },
  nachname:      { names: ["nachname", "lastname", "last_name", "surname", "family-name", "lname"], labels: ["Nachname", "Last name", "Familienname"] },
  name:          { names: ["fullname", "full_name", "name"], labels: ["Name", "Vollständiger Name"] },
  email:         { names: ["email", "e-mail", "mail"], types: ["email"], labels: ["E-Mail", "Email", "E-Mail-Adresse"] },
  telefon:       { names: ["telefon", "phone", "tel", "mobile", "handy"], types: ["tel"], labels: ["Telefon", "Phone", "Mobil", "Handy", "Rufnummer"] },
  geburtsdatum:  { names: ["geburtsdatum", "birthdate", "dob", "birthday"], types: ["date"], labels: ["Geburtsdatum", "Date of birth"] },
  starttermin:   { names: ["starttermin", "eintrittsdatum", "verfuegbar", "verfügbar", "startdate", "availablefrom"], labels: ["Frühestmöglicher Starttermin", "Starttermin", "Eintrittsdatum", "Verfügbar ab", "Earliest start", "Start date"] },
  nationalitaet: { nat: true, names: ["nationalitaet", "nationality", "staatsangehoerigkeit"], labels: ["Nationalität", "Staatsangehörigkeit", "Nationality"] },
  adresse:       { names: ["adresse", "address", "strasse", "street"], labels: ["Adresse", "Straße", "Anschrift", "Address"] },
  anstellungsort:{ names: ["anstellungsort", "arbeitsort", "einsatzort", "wunschort", "worklocation"], labels: ["Gewünschter Anstellungsort", "Anstellungsort", "Arbeitsort", "Einsatzort", "Desired location"] },
  ort:           { names: ["ort", "city", "stadt", "wohnort"], labels: ["Ort", "Stadt", "Wohnort", "City"] },
  land:          { names: ["land", "country", "staat"], labels: ["Land", "Country"], select: true },
  beruf:         { names: ["beruf", "position", "jobtitle", "job_title", "taetigkeit"], labels: ["Beruf", "Position", "Tätigkeit", "Berufsbezeichnung"] },
  berufserfahrung:{ names: ["berufserfahrung", "jahreberufserfahrung"], labels: ["Berufserfahrung", "Jahre Berufserfahrung", "Berufserfahrung in Jahren", "Years of experience"] },
  deutschniveau: { level: true, names: ["deutsch", "german", "sprachniveau"], labels: ["Deutschkenntnisse", "Deutsch", "Sprachkenntnisse - Deutsch", "German level"] },
  englischniveau:{ level: true, names: ["englisch", "english"], labels: ["Englischkenntnisse", "Englisch", "Sprachkenntnisse - Englisch", "English level", "English"] },
  gehaltswunsch:    { names: ["gehalt", "salary", "gehaltswunsch", "gehaltsvorstellung", "compensation"], labels: ["Gehaltswunsch", "Gehaltsvorstellung", "Gehalt", "Salary", "Salary expectation"] },
  aufenthaltstitel: { names: ["aufenthalt", "aufenthaltstitel", "residence", "residencepermit"], labels: ["Aufenthaltstitel", "Aufenthaltsstatus", "Aufenthalt", "Residence permit", "Residence title"] },
  arbeitserlaubnis: { names: ["arbeitserlaubnis", "arbeitsgenehmigung", "workpermit", "work_permit"], labels: ["Arbeitserlaubnis", "Arbeitsgenehmigung", "Work permit"] },
  fuehrerschein:    { names: ["fuehrerschein", "führerschein", "driverlicense", "drivinglicense", "fuehrerscheinklasse"], labels: ["Führerschein", "Fahrerlaubnis", "Driving license", "Driver's license"] },
  arbeitszeitVollzeit: { radio: true, names: ["vollzeit", "fulltime"], labels: ["40h/Vollzeit", "Vollzeit", "full time", "full-time", "40h", "40 h"] },
  arbeitserlaubnisJa: { checkbox: true, names: ["arbeitserlaubnis", "arbeitsgenehmigung", "workpermit", "work_permit"], labels: ["Gültige Arbeitserlaubnis", "Arbeitserlaubnis", "Arbeitsgenehmigung", "Work permit"] },
};

export const FILE_MATCH = {
  names: ["lebenslauf", "cv", "resume", "datei", "anhang", "upload", "file", "dokument"],
  labels: ["Lebenslauf", "CV", "Anhang", "Datei", "Dokument", "Bewerbungsunterlagen"],
};

// Descriptor of a REQUIRED text/select field the static mapping could not fill —
// STRUCTURE ONLY (no candidate PII), so it can be sent to an LLM for semantic
// mapping to a known candidate key. Each is tagged in the DOM as
// [data-mz-field="<marker>"] so __mzFillMapped can fill it afterwards.
export interface UnmatchedField {
  marker: string;
  label: string;
  name: string;
  type: string;            // "text" | "select"
  options?: string[];      // visible option texts (selects)
}

export interface FillReport {
  formPresent: boolean;
  filled: number;
  cvAttached: boolean;
  cvNeeded: boolean;
  missingRequired: string[];   // labels of REQUIRED inputs left empty → block submit
  unmatchedRequired: UnmatchedField[]; // subset of the above that an LLM can map
  consentTicked: string[];     // required privacy/consent checkboxes we ticked
  submitMarked: boolean;       // a submit control was found + tagged [data-mz-submit]
}

// Result of __mzFillMapped (LLM-mapped second pass).
export interface MappedFillResult {
  filled: number;
  stillMissing: string[];
}

/**
 * A self-contained browser script (string). Defines window.__mzFill(data) which
 * fills the form, tags the submit button, and returns a FillReport. `data` is the
 * same shape the /prefill endpoint returns: { fields: {key:val}, cv: {filename,
 * mimeType, dataBase64} | null }. Selector map is inlined below.
 */
export const FILL_SCRIPT = `
(function () {
  var S = ${JSON.stringify(FORM_SELECTORS)};
  var FILE_MATCH = ${JSON.stringify(FILE_MATCH)};
  var norm = function (s) { return (s || "").toString().toLowerCase(); };

  function labelTextFor(el) {
    var t = (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("name") || "") + " " + (el.id || "");
    if (el.id) { var lab = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (lab) t += " " + lab.textContent; }
    var lb = el.getAttribute("aria-labelledby");
    if (lb) { lb.split(/\\s+/).forEach(function (id) { var e = id && document.getElementById(id); if (e) t += " " + e.textContent; }); }
    var wrap = el.closest ? el.closest("label") : null;
    if (wrap) t += " " + wrap.textContent;
    var p = el;
    for (var i = 0; i < 8 && p; i++) {
      var prev = p.previousElementSibling;
      var ptxt = prev && prev.tagName !== "BUTTON" ? (prev.textContent || "").trim() : "";
      if (ptxt && ptxt.length <= 180) { t += " " + ptxt; break; }
      var par = p.parentElement;
      if (par) {
        var lab2 = null;
        try { lab2 = par.querySelector(":scope > label, :scope > legend"); } catch (e) {}
        var ltxt = lab2 && !lab2.contains(el) ? (lab2.textContent || "").trim() : "";
        if (ltxt && ltxt.length <= 180) { t += " " + ltxt; break; }
      }
      p = par;
    }
    return norm(t);
  }

  function matches(el, spec) {
    var hay = labelTextFor(el);
    if (spec.types && spec.types.indexOf((el.getAttribute("type") || "").toLowerCase()) >= 0) return true;
    if (spec.names && spec.names.some(function (n) { return hay.indexOf(norm(n)) >= 0; })) return true;
    if (spec.labels && spec.labels.some(function (l) { return hay.indexOf(norm(l)) >= 0; })) return true;
    return false;
  }

  function setValue(el, val) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setSelect(el, val) {
    var want = norm(val); if (!want) return false;
    var opts = Array.prototype.slice.call(el.options);
    var opt = opts.filter(function (o) { return norm(o.value) === want || norm(o.textContent) === want; })[0]
      || opts.filter(function (o) { return o.value !== "" && (norm(o.textContent).indexOf(want) >= 0 || (want.length >= 3 && norm(o.value).indexOf(want) >= 0)); })[0];
    if (opt && opt.value !== "") { el.value = opt.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    return false;
  }
  function levelCandidates(cefr) {
    var v = norm(cefr);
    var M = { a1:["a1","anfänger","anfaenger","beginner","basic","grundkenntnisse"], a2:["a2","grundkenntnisse","basic","elementary","anfänger"], b1:["b1","fortgeschritten","intermediate","gut","mittelstufe"], b2:["b2","gut","good","fortgeschritten","upper intermediate"], c1:["c1","fließend","fliessend","fluent","verhandlungssicher","sehr gut"], c2:["c2","fließend","fliessend","fluent","muttersprachlich","verhandlungssicher"], muttersprache:["muttersprache","native","mother tongue","muttersprachlich","fließend"] };
    return M[v] || [cefr];
  }
  function natCandidates(val) {
    var v = norm(val);
    if (/aserbaid|azerbaij|az[əe]rbayc?an/.test(v)) return ["Aserbaidschan","Azerbaijan","Aserbaidschanisch","Azerbaidzhan","Azərbaycan"];
    return [val];
  }
  function setCheckbox(el, val) {
    var on = /^(ja|yes|true|1|x|vorhanden|ja,?\\s|✓)/i.test(String(val).trim());
    if (el.checked !== on) { el.checked = on; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
    return true;
  }
  function setRadio(el) { if (!el.checked) { el.checked = true; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } return true; }
  function kindOf(el) { if (el.tagName === "SELECT") return "select"; var t = (el.getAttribute("type") || "").toLowerCase(); if (t === "checkbox") return "checkbox"; if (t === "radio") return "radio"; return "text"; }
  function fillableKinds(spec) { if (spec.checkbox) return ["checkbox"]; if (spec.radio) return ["radio"]; return ["text", "select"]; }
  function fileFromBase64(b64, name, mime) { var bin = atob(b64); var arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new File([arr], name, { type: mime }); }
  function isVisible(el) { return el.type !== "hidden" && el.type !== "submit" && el.type !== "button" && !el.disabled && el.offsetParent !== null; }
  function isRequired(el) { return el.required === true || String(el.getAttribute("aria-required")).toLowerCase() === "true"; }
  function isConsent(el) { return /datenschutz|einwillig|zustimm|einverstand|privacy|consent|\\bagb\\b|verarbeitung|hinweis/i.test(labelTextFor(el)); }

  window.__mzFill = function (data) {
    var root = document; // fill against the whole document; ATS forms vary
    var all = Array.prototype.slice.call(root.querySelectorAll("input, textarea, select"));
    var inputs = all.filter(isVisible);
    var report = { formPresent: inputs.length >= 2, filled: 0, cvAttached: false, cvNeeded: false, missingRequired: [], unmatchedRequired: [], consentTicked: [], submitMarked: false };
    var used = [];
    var fields = data.fields || {};
    Object.keys(fields).forEach(function (key) {
      var val = fields[key]; if (!val) return;
      var spec = S[key]; if (!spec) return;
      var kinds = fillableKinds(spec);
      var el = inputs.filter(function (i) { return used.indexOf(i) < 0 && kinds.indexOf(kindOf(i)) >= 0 && matches(i, spec); })[0];
      if (!el) return;
      var k = kindOf(el);
      try {
        if (k === "select") {
          var cands = spec.level ? levelCandidates(val) : spec.nat ? natCandidates(val) : [val];
          var ok = false; for (var c = 0; c < cands.length; c++) { if (setSelect(el, cands[c])) { ok = true; break; } }
          if (ok) { used.push(el); report.filled++; }
        } else if (k === "checkbox") { if (setCheckbox(el, val)) { used.push(el); report.filled++; } }
        else if (k === "radio") { if (setRadio(el)) { used.push(el); report.filled++; } }
        else {
          var v = val;
          if ((el.getAttribute("type") || "").toLowerCase() !== "date" && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(v))) { var pt = String(v).split("-"); v = pt[2] + "." + pt[1] + "." + pt[0]; }
          setValue(el, v); used.push(el); report.filled++;
        }
      } catch (e) {}
    });

    // CV file input
    var fileInput = inputs.filter(function (i) { return i.type === "file" && matches(i, FILE_MATCH); })[0] || root.querySelector('input[type="file"]');
    if (fileInput) {
      report.cvNeeded = isRequired(fileInput) || true; // a present file field is treated as expected
      if (data.cv) {
        try {
          var file = fileFromBase64(data.cv.dataBase64, data.cv.filename, data.cv.mimeType);
          var dt = new DataTransfer(); dt.items.add(file);
          fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          report.cvAttached = true;
        } catch (e) {}
      }
    }

    // REQUIRED consent/privacy checkboxes. Auto-ticking a legal "I accept the
    // privacy policy / terms" box on a candidate's behalf is legally meaningful,
    // so it happens ONLY when the engine explicitly passes acceptConsent=true
    // (its own env flag, default off). Otherwise these boxes stay empty → they
    // fall into missingRequired below → the job routes to the human queue instead
    // of being auto-submitted. Recorded either way.
    if (data.acceptConsent) {
      inputs.filter(function (i) { return kindOf(i) === "checkbox" && isRequired(i) && !i.checked && isConsent(i); }).forEach(function (i) {
        i.checked = true; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));
        report.consentTicked.push((labelTextFor(i) || "consent").slice(0, 60));
      });
    }

    // Any REQUIRED, still-empty field blocks submission (no garbage
    // applications). A required TEXT/SELECT field also gets a marker + descriptor
    // so an LLM can try to map it semantically in a second pass.
    var reqIdx = 0;
    inputs.forEach(function (el) {
      if (!isRequired(el)) return;
      var k = kindOf(el);
      var empty = k === "checkbox" || k === "radio" ? !el.checked : !String(el.value || "").trim();
      if (k === "radio") { // a radio group counts as filled if ANY option in the group is checked
        var nm = el.name; if (nm) { var grp = all.filter(function (x) { return x.name === nm; }); if (grp.some(function (x) { return x.checked; })) empty = false; }
      }
      if (!empty) return;
      var lbl = (labelTextFor(el) || el.name || "unbenannt").slice(0, 60);
      report.missingRequired.push(lbl);
      if (k === "text" || k === "select") {
        var marker = "u" + (reqIdx++);
        el.setAttribute("data-mz-field", marker);
        var desc = { marker: marker, label: lbl, name: el.name || "", type: k };
        if (k === "select") { desc.options = Array.prototype.slice.call(el.options).map(function (o) { return (o.textContent || "").trim(); }).filter(Boolean).slice(0, 40); }
        report.unmatchedRequired.push(desc);
      }
    });
    if (fileInput && isRequired(fileInput) && !report.cvAttached) report.missingRequired.push("Lebenslauf/CV");

    // Tag the submit control so the engine (Node side) can click it precisely.
    var submit = root.querySelector('form [type="submit"], form button[type="submit"], button[type="submit"], input[type="submit"]')
      || Array.prototype.slice.call(root.querySelectorAll("form button, button")).filter(function (b) { return /bewerb|absenden|senden|submit|apply|abschick/i.test((b.textContent || "") + " " + (b.value || "")); })[0];
    if (submit) { submit.setAttribute("data-mz-submit", "1"); report.submitMarked = true; }

    return report;
  };

  // Second pass: fill the fields an LLM mapped. mapping = { marker: candidateKey },
  // values = { candidateKey: value } (our data — PII never left the server for the
  // mapping decision). Returns how many filled + the required fields STILL empty.
  window.__mzFillMapped = function (mapping, values) {
    var out = { filled: 0, stillMissing: [] };
    mapping = mapping || {}; values = values || {};
    Object.keys(mapping).forEach(function (marker) {
      var key = mapping[marker]; if (!key) return;
      var el = document.querySelector('[data-mz-field="' + marker + '"]'); if (!el) return;
      var val = values[key]; if (!val) return;
      try {
        if (kindOf(el) === "select") { if (setSelect(el, val)) out.filled++; }
        else { setValue(el, val); out.filled++; }
      } catch (e) {}
    });
    var all2 = Array.prototype.slice.call(document.querySelectorAll("input, textarea, select")).filter(isVisible);
    all2.forEach(function (el) {
      if (!isRequired(el)) return;
      var k = kindOf(el);
      var empty = k === "checkbox" || k === "radio" ? !el.checked : !String(el.value || "").trim();
      if (k === "radio") { var nm = el.name; if (nm) { var grp = all2.filter(function (x) { return x.name === nm; }); if (grp.some(function (x) { return x.checked; })) empty = false; } }
      if (empty) out.stillMissing.push((labelTextFor(el) || el.name || "unbenannt").slice(0, 60));
    });
    return out;
  };
})();
`;

// Deduplicate the missingRequired list (labels can repeat) — used Node-side.
export function dedupeMissing(m: string[]): string[] {
  return Array.from(new Set(m.map((s) => s.trim()).filter(Boolean)));
}
