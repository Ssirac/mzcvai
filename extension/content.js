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
    const wrap = el.closest("label");
    if (wrap) t += " " + wrap.textContent;
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
    const opt = Array.from(el.options).find((o) => norm(o.value) === want || norm(o.textContent) === want || norm(o.textContent).includes(want));
    if (opt) { el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    return false;
  }

  function fileFromBase64(b64, name, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  }

  function fillForm(data) {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((el) => el.type !== "hidden" && el.type !== "submit" && el.type !== "button" && !el.disabled && el.offsetParent !== null);
    let filled = 0;
    for (const [key, val] of Object.entries(data.fields || {})) {
      if (!val) continue;
      const spec = S[key];
      if (!spec) continue;
      const el = inputs.find((i) => (i.tagName === "SELECT") === !!spec.select && matches(i, spec));
      if (!el) continue;
      try {
        if (el.tagName === "SELECT") { if (setSelect(el, val)) filled++; }
        else { setValue(el, val); filled++; }
      } catch { /* skip */ }
    }
    // CV file input
    let cvNote = "";
    if (data.cv) {
      const fileInput = inputs.find((i) => i.type === "file" && matches(i, FILE_MATCH))
        || document.querySelector('input[type="file"]');
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

  async function onFill() {
    const { mzBaseUrl, mzCandidateId } = await chrome.storage.sync.get(["mzBaseUrl", "mzCandidateId"]);
    if (!mzBaseUrl || !mzCandidateId) { toast("MZ Autofill: bitte im Popup Basis-URL und Kandidat wählen.", false); return; }
    let res, data;
    try {
      res = await fetch(`${mzBaseUrl.replace(/\/+$/, "")}/api/candidates/${mzCandidateId}/prefill`, { credentials: "include" });
    } catch { toast("MZ Autofill: keine Verbindung zur MZ-App.", false); return; }
    if (res.status === 401) { toast("MZ Autofill: nicht eingeloggt. Bitte in der MZ-App anmelden.", false); return; }
    if (!res.ok) { toast(`MZ Autofill: Fehler ${res.status}.`, false); return; }
    data = await res.json();
    const { filled, cvNote } = fillForm(data);
    copyPanel(data); // fallback: fields also on the clipboard
    toast(`MZ Autofill: ${filled} Felder ausgefüllt${cvNote}. CAPTCHA & Absenden bitte selbst.`, true);
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountButton);
  else mountButton();
})();
