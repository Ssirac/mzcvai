/**
 * Service worker — fetches candidate prefill data in the EXTENSION context so the
 * MZ session cookie is sent (a content-script cross-site fetch would drop the
 * SameSite=Lax cookie). Self-heals to the production URL if the configured base
 * can't be reached.
 *
 * The "carry the candidate across a redirect to an external ATS" logic lives in
 * the content script (via chrome.storage), not here — fewer moving parts.
 */
const PROD_BASE = "https://mzcvai-production.up.railway.app";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "mzPrefill") return;
  (async () => {
    const configured = String(msg.baseUrl || "").replace(/\/+$/, "");
    const bases = [];
    if (/^https?:\/\//i.test(configured)) bases.push(configured);
    if (!bases.includes(PROD_BASE)) bases.push(PROD_BASE);

    let lastErr = "";
    for (const base of bases) {
      const url = `${base}/api/candidates/${msg.candidateId}/prefill`;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (res.status === 401) return sendResponse({ error: "unauth", detail: base });
        if (!res.ok) { lastErr = `HTTP ${res.status} → ${url}`; continue; }
        return sendResponse({ data: await res.json(), usedBase: base });
      } catch (e) {
        lastErr = `${(e && e.message) || e} → ${url}`;
      }
    }
    sendResponse({ error: "network", detail: lastErr });
  })();
  return true; // async response
});
