/**
 * MZ Autofill — content script.
 *
 * Shows a floating "Daten ausfüllen" button on every page. When the human clicks
 * it (AFTER clearing any captcha themselves), it fetches the selected candidate's
 * data from the MZ app and fills the matching form fields + attaches the CV.
 *
 * HARD RULES (never violated): it does NOT detect, solve, or bypass captchas, and
 * it does NOT submit the form. The human confirms the captcha and presses send.
 */
(() => {
  const S = window.MZ_SELECTORS || {};
  const FILE_MATCH = window.MZ_FILE_MATCH || { names: [], labels: [] };

  // ---- helpers ----------------------------------------------------------------
  const norm = (s) => (s || "").toString().toLowerCase();

  function labelTextFor(el) {
    let t = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("name") || ""} ${el.id || ""}`;
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) t += " " + lab.textContent;
    }
    // aria-labelledby → the referenced element's text (React ATS use this a lot).
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { for (const id of lb.split(/\s+/)) { const e = id && document.getElementById(id); if (e) t += " " + e.textContent; } }
    const wrap = el.closest("label");
    if (wrap) t += " " + wrap.textContent;
    // Custom ATS (onlyfy, softgarden…) render the question as a SIBLING node
    // ("4 - Gehaltsvorstellungen…") or as a <label>/<legend> wrapping the field
    // group — NOT a <label for>. The control can sit several React wrappers deep,
    // so walk up generously; at each level take the nearest short preceding
    // sibling, or a label/legend that is a direct child of the ancestor.
    let p = el;
    for (let i = 0; i < 8 && p; i++) {
      const prev = p.previousElementSibling;
      const ptxt = prev && (prev.textContent || "").trim();
      if (ptxt && ptxt.length <= 180) { t += " " + ptxt; break; }
      const par = p.parentElement;
      if (par) {
        let lab = null;
        try { lab = par.querySelector(":scope > label, :scope > legend"); } catch { /* older engines */ }
        const ltxt = lab && !lab.contains(el) ? (lab.textContent || "").trim() : "";
        if (ltxt && ltxt.length <= 180) { t += " " + ltxt; break; }
      }
      p = par;
    }
    return norm(t);
  }

  function matches(el, spec) {
    const hay = labelTextFor(el);
    if (spec.types && spec.types.includes((el.getAttribute("type") || "").toLowerCase())) return true;
    if (spec.names && spec.names.some((n) => hay.includes(norm(n)))) return true;
    if (spec.labels && spec.labels.some((l) => hay.includes(norm(l)))) return true;
    return false;
  }

  // React-safe value set (uses the native setter so controlled inputs update).
  function setValue(el, val) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setSelect(el, val) {
    const want = norm(val);
    if (!want) return false;
    const opts = Array.from(el.options);
    // Exact match first (value or visible text), then a looser contains match —
    // so "gut" picks "Gut", not "Sehr gut" when an exact "Gut" exists. Never
    // pick the empty placeholder option.
    const opt = opts.find((o) => norm(o.value) === want || norm(o.textContent) === want)
      || opts.find((o) => o.value !== "" && (norm(o.textContent).includes(want) || (want.length >= 3 && norm(o.value).includes(want))));
    if (opt && opt.value !== "") {
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  // Map a CEFR level (A1..C2 / Muttersprache) to the words a language-skill
  // dropdown might use, tried in order. The CEFR code goes first (some forms list
  // A1..C2 directly), then descriptive synonyms (Anfänger/Gut/Fließend…) so word
  // dropdowns (onlyfy) also fill.
  function levelCandidates(cefr) {
    const v = norm(cefr);
    const M = {
      "a1": ["a1", "anfänger", "anfaenger", "beginner", "basic", "grundkenntnisse"],
      "a2": ["a2", "grundkenntnisse", "basic", "elementary", "anfänger"],
      "b1": ["b1", "fortgeschritten", "intermediate", "gut", "mittelstufe"],
      "b2": ["b2", "gut", "good", "fortgeschritten", "upper intermediate"],
      "c1": ["c1", "fließend", "fliessend", "fluent", "verhandlungssicher", "sehr gut"],
      "c2": ["c2", "fließend", "fliessend", "fluent", "muttersprachlich", "verhandlungssicher"],
      "muttersprache": ["muttersprache", "native", "mother tongue", "muttersprachlich", "fließend"],
    };
    return M[v] || [cefr];
  }

  // Checkbox: tick when the value is affirmative ("Ja"/"yes"/true/…). An empty
  // value never reaches here (skipped earlier), so a box is only ever CHECKED on
  // a real signal, never blindly. The human reviews before submitting.
  function setCheckbox(el, val) {
    const on = /^(ja|yes|true|1|x|vorhanden|ja,?\s|✓)/i.test(String(val).trim());
    if (el.checked !== on) {
      el.checked = on;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  // Select a radio option (checking it = choosing that answer). Only ever used
  // for specs that map to a business FACT (e.g. full-time), never to guess a
  // candidate's situational answer.
  function setRadio(el) {
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  // What kind of control is this element?
  function kindOf(el) {
    if (el.tagName === "SELECT") return "select";
    const t = (el.getAttribute("type") || "").toLowerCase();
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    return "text";
  }
  // Which control kinds a spec may fill. Checkbox specs stay checkbox-only (so a
  // Yes/No box and a free-text field sharing a label don't collide). Every other
  // field fills a text/textarea OR a <select> — whichever the site actually uses
  // (onlyfy/XING renders nationality, country, language level as dropdowns; other
  // ATS render them as text). We fill by the input's REAL kind, not a guess.
  function fillableKinds(spec) {
    if (spec.checkbox) return ["checkbox"];
    if (spec.radio) return ["radio"];
    return ["text", "select"];
  }

  function fileFromBase64(b64, name, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  }

  // Scope the fill to the real application form when a site mixes it with a
  // search/login box on the same page (e.g. hotelcareer.de, whose apply fields
  // live in <form id="perdata"> alongside an unrelated search and login form).
  function appRoot() {
    if (/(^|\.)hotelcareer\.de$/i.test(location.hostname)) {
      const b = document.querySelector('[name^="bewdata["]');
      const f = b && b.closest("form");
      if (f) return f;
    }
    return document;
  }

  function fillForm(data) {
    const root = appRoot();
    const inputs = Array.from(root.querySelectorAll("input, textarea, select"))
      .filter((el) => el.type !== "hidden" && el.type !== "submit" && el.type !== "button" && !el.disabled && el.offsetParent !== null);
    let filled = 0;
    // Each input is filled at most once. Fields are iterated most-specific first
    // (vorname/nachname before the generic full-"name"), so e.g. a "First name"
    // input — whose label contains "name" and would otherwise also match the
    // generic `name` field — keeps the first name instead of being overwritten
    // with the full name.
    const used = new Set();
    for (const [key, val] of Object.entries(data.fields || {})) {
      if (!val) continue;
      const spec = S[key];
      if (!spec) continue;
      const kinds = fillableKinds(spec);
      const el = inputs.find((i) => !used.has(i) && kinds.includes(kindOf(i)) && matches(i, spec));
      if (!el) continue;
      // Fill according to the element's ACTUAL kind (a spec may target text OR select).
      const k = kindOf(el);
      try {
        if (k === "select") {
          // Language-level selects try CEFR then descriptive synonyms.
          const cands = spec.level ? levelCandidates(val) : [val];
          let ok = false;
          for (const cv of cands) { if (setSelect(el, cv)) { ok = true; break; } }
          if (ok) { used.add(el); filled++; }
        }
        else if (k === "checkbox") { if (setCheckbox(el, val)) { used.add(el); filled++; } }
        else if (k === "radio") { if (setRadio(el)) { used.add(el); filled++; } }
        else {
          let v = val;
          // Date fields: a native <input type=date> wants the ISO YYYY-MM-DD we
          // send, but a German TEXT date mask expects dd.mm.yyyy — convert for text.
          if ((el.getAttribute("type") || "").toLowerCase() !== "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
            const [y, m, d] = String(v).split("-"); v = `${d}.${m}.${y}`;
          }
          setValue(el, v); used.add(el); filled++;
        }
      } catch { /* skip */ }
    }
    // CV file input
    let cvNote = "";
    if (data.cv) {
      const fileInput = inputs.find((i) => i.type === "file" && matches(i, FILE_MATCH))
        || root.querySelector('input[type="file"]');
      if (fileInput) {
        try {
          const file = fileFromBase64(data.cv.dataBase64, data.cv.filename, data.cv.mimeType);
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          cvNote = " + Lebenslauf angehängt";
        } catch { cvNote = " (Lebenslauf-Upload manuell nötig)"; }
      } else {
        cvNote = " (kein Datei-Feld gefunden — Lebenslauf manuell hochladen)";
      }
    }
    return { filled, cvNote };
  }

  function copyPanel(data) {
    const lines = Object.entries(data.fields || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
  }

  // ---- UI ---------------------------------------------------------------------
  function toast(msg, ok) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:70px;right:16px;z-index:2147483647;max-width:320px;padding:10px 14px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.3);background:${ok ? "#059669" : "#dc2626"}`;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // Known MZ app origin — used as a fallback when the popup's Base-URL is unset
  // (e.g. right after a fresh install) so auto-fill still works with no setup.
  const MZ_FALLBACK_BASE = "https://mzcvai-production.up.railway.app";

  // Core fill routine. candidateOverride (from the #mzfill hash) wins over the
  // popup's saved candidate, so a job opened from the MZ queue fills for THAT
  // candidate — not just the single one configured in the popup.
  async function doFill(candidateOverride) {
    const { mzBaseUrl, mzCandidateId } = await chrome.storage.sync.get(["mzBaseUrl", "mzCandidateId"]);
    const candidateId = candidateOverride || mzCandidateId;
    const baseUrl = mzBaseUrl || MZ_FALLBACK_BASE; // background also self-heals to prod
    if (!candidateId) { toast("MZ Autofill: bitte im Popup einen Kandidaten wählen (oder aus der Robot-Queue öffnen).", false); return; }
    // Fetch via the background service worker (extension context) so the MZ
    // session cookie is sent — a content-script fetch here would be cross-site
    // and the SameSite=Lax cookie would be dropped.
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: "mzPrefill", baseUrl, candidateId });
    } catch { toast("MZ Autofill: interner Fehler.", false); return; }
    if (!resp) { toast("MZ Autofill: keine Antwort.", false); return; }
    if (resp.error === "unauth") { toast("MZ Autofill: nicht eingeloggt. Bitte in der MZ-App anmelden.", false); return; }
    if (resp.error === "badurl") { toast(`MZ Autofill: ungültige Basis-URL (${resp.detail}). Im Popup korrigieren.`, false); return; }
    if (resp.error === "network") { toast(`MZ Autofill: keine Verbindung — ${resp.detail || "MZ-App nicht erreichbar"}.`, false); return; }
    if (resp.error) { toast(`MZ Autofill: Fehler (${resp.error}).`, false); return; }
    const data = resp.data;
    const { filled, cvNote } = fillForm(data);
    copyPanel(data); // fallback: fields also on the clipboard
    toast(`MZ Autofill: ${filled} Felder ausgefüllt${cvNote}. CAPTCHA & Absenden bitte selbst.`, true);
    return filled;
  }

  const onFill = () => doFill();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- "arm" the intent across a redirect to an external ATS -----------------
  // Stored in chrome.storage (accessible to content scripts directly — no
  // background needed). Short-lived and single-use for safety.
  const ARM_KEY = "mzArm";
  const ARM_TTL_MS = 3 * 60 * 1000; // 3 minutes
  async function armCandidate(candidateId) {
    try { await chrome.storage.local.set({ [ARM_KEY]: { candidateId, expiresAt: Date.now() + ARM_TTL_MS } }); } catch { /* ignore */ }
  }
  async function readArmedCandidate() {
    try {
      const v = (await chrome.storage.local.get(ARM_KEY))[ARM_KEY];
      if (v && v.expiresAt > Date.now()) return v.candidateId;
    } catch { /* ignore */ }
    return null;
  }
  async function clearArm() { try { await chrome.storage.local.remove(ARM_KEY); } catch { /* ignore */ } }

  // Strict check for the ARMED path: the page must have BOTH a name field AND an
  // email or file field — so a stray form (e.g. a newsletter box) is never
  // auto-filled while an arm is active.
  function isApplicationForm() {
    const root = appRoot();
    const inputs = Array.from(root.querySelectorAll("input, textarea"))
      .filter((el) => el.type !== "hidden" && el.type !== "submit" && el.type !== "button" && !el.disabled && el.offsetParent !== null);
    const hasName = inputs.some((i) => matches(i, S.vorname) || matches(i, S.nachname));
    const hasEmailOrFile = inputs.some((i) => matches(i, S.email)) || !!root.querySelector('input[type="file"]');
    return hasName && hasEmailOrFile;
  }

  // Auto-fill when a job was opened from the MZ queue: the queue appends
  // "#mzfill=<candidateId>" to the URL. We ONLY act when the page was opened FROM
  // an MZ app origin (referrer check), so a random site can't craft the hash to
  // harvest candidate data. We also ARM the candidate, so if the "Apply" button
  // then redirects to an external ATS the candidate carries across. Returns true
  // if a form on THIS page was filled. Never submits.
  async function maybeAutoFill() {
    const m = location.hash.match(/mzfill=([^&]+)/);
    if (!m) return false;
    const candidateId = decodeURIComponent(m[1]);
    const { mzBaseUrl } = await chrome.storage.sync.get(["mzBaseUrl"]);
    const allowed = new Set();
    try { allowed.add(new URL(MZ_FALLBACK_BASE).origin); } catch { /* ignore */ }
    if (mzBaseUrl) { try { allowed.add(new URL(mzBaseUrl).origin); } catch { /* ignore */ } }
    try {
      if (!document.referrer || !allowed.has(new URL(document.referrer).origin)) return false;
    } catch { return false; }
    // Arm first, so a redirect-to-ATS still knows the candidate.
    await armCandidate(candidateId);
    // Only fill if THIS page is actually an application form. Crucial: a job
    // board's own search box (e.g. an "Ort" field) must NOT count as a fill — that
    // would wrongly consume the arm before we reach the ATS form.
    for (let i = 0; i < 4; i++) {
      if (isApplicationForm()) {
        const filled = await doFill(candidateId);
        if (filled && filled > 0) { await clearArm(); return true; }
      }
      await sleep(1200);
    }
    return false; // no form here — leave the arm for the ATS page
  }

  // Downstream auto-fill: the page has no hash, but an MZ-originated page armed a
  // candidate moments ago. Fill only real application forms, then consume the arm
  // (fill once — never on an unrelated page).
  async function maybeAutoFillFromArm() {
    const candidateId = await readArmedCandidate();
    if (!candidateId) return;
    for (let i = 0; i < 8; i++) {
      if (isApplicationForm()) {
        const filled = await doFill(candidateId);
        if (filled && filled > 0) { await clearArm(); return; }
      }
      await sleep(1200);
    }
  }

  function mountButton() {
    if (document.getElementById("mz-autofill-btn")) return;
    const btn = document.createElement("button");
    btn.id = "mz-autofill-btn";
    btn.textContent = "MZ: Daten ausfüllen";
    btn.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:10px 16px;border:none;border-radius:999px;background:#059669;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer";
    btn.addEventListener("click", onFill);
    document.documentElement.appendChild(btn);
  }

  // The MZ app itself is never an application form — don't mount the floating
  // button there (it covered parts of the dashboard UI) and don't run the
  // autofill loops (a stale arm must not try to fill the app's own candidate
  // forms). Checks both the fallback origin and the popup-configured base URL.
  async function isMzAppOrigin() {
    const origins = new Set();
    try { origins.add(new URL(MZ_FALLBACK_BASE).origin); } catch { /* ignore */ }
    try {
      const { mzBaseUrl } = await chrome.storage.sync.get(["mzBaseUrl"]);
      if (mzBaseUrl) origins.add(new URL(mzBaseUrl).origin);
    } catch { /* ignore */ }
    return origins.has(location.origin);
  }

  function start() {
    (async () => {
      if (await isMzAppOrigin()) return; // stay out of our own app entirely
      // Mount the floating button ONLY where it can actually do something:
      // an MZ-initiated visit (hash/arm), or a page that looks like a real
      // application form (checked with retries — ATS forms often render late).
      // On every other site (news, dashboards, webmail…) it stays hidden.
      const mzInitiated = /mzfill=/.test(location.hash) || !!(await readArmedCandidate());
      if (mzInitiated) mountButton();
      const filledHere = await maybeAutoFill(); // hash path (direct form)
      if (!filledHere) await maybeAutoFillFromArm(); // armed path (redirected ATS)
      if (!document.getElementById("mz-autofill-btn")) {
        for (let i = 0; i < 6; i++) {
          if (isApplicationForm()) { mountButton(); break; }
          await sleep(1500);
        }
      }
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
