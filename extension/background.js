/**
 * Service worker — two jobs:
 *
 * 1) Fetch candidate prefill data in the EXTENSION context (so the MZ session
 *    cookie is sent; a content-script cross-site fetch would drop the SameSite
 *    Lax cookie). Self-heals to the production URL if the configured base fails.
 *
 * 2) Carry the "which candidate" intent across a redirect to an external ATS.
 *    When a job is opened from the MZ queue (referrer = MZ app), the content
 *    script arms THAT tab with the candidate id. If the job's "Apply" button
 *    then navigates to a different domain (e.g. jobylon.com) — same tab or a new
 *    tab opened from it — the arm follows, so the ATS form auto-fills for the
 *    right candidate. Safety: arming only originates from an MZ-referred page,
 *    is scoped per tab (inherited only along the opener chain), expires after a
 *    few minutes, and is consumed the moment a form is actually filled — so a
 *    random site can never trigger it and no unrelated page gets auto-filled.
 */
const PROD_BASE = "https://mzcvai-production.up.railway.app";
const ARM_TTL_MS = 10 * 60 * 1000;

// ---- per-tab arming (persisted in session storage so it survives SW restarts)
async function getArms() {
  try { return (await chrome.storage.session.get("mzArms")).mzArms || {}; } catch { return {}; }
}
async function setArms(a) { try { await chrome.storage.session.set({ mzArms: a }); } catch { /* ignore */ } }
async function armTab(tabId, candidateId) {
  if (tabId == null || !candidateId) return;
  const a = await getArms();
  a[tabId] = { candidateId, expiresAt: Date.now() + ARM_TTL_MS };
  await setArms(a);
}
async function readArm(tabId) {
  if (tabId == null) return null;
  const a = await getArms();
  const e = a[tabId];
  return e && e.expiresAt > Date.now() ? e.candidateId : null;
}
async function disarmTab(tabId) {
  const a = await getArms();
  if (a[tabId] != null) { delete a[tabId]; await setArms(a); }
}

// A new tab opened from an armed tab (e.g. "Jetzt bewerben" → ATS) inherits it.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab && tab.id != null && tab.openerTabId != null) {
    const cid = await readArm(tab.openerTabId);
    if (cid) await armTab(tab.id, cid);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => { void disarmTab(tabId); });

// ---- prefill fetch (self-healing base URL) ----------------------------------
async function fetchPrefill(configuredBase, candidateId, sendResponse) {
  const configured = String(configuredBase || "").replace(/\/+$/, "");
  const bases = [];
  if (/^https?:\/\//i.test(configured)) bases.push(configured);
  if (!bases.includes(PROD_BASE)) bases.push(PROD_BASE);

  let lastErr = "";
  for (const base of bases) {
    const url = `${base}/api/candidates/${candidateId}/prefill`;
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
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (!msg) return;

  if (msg.type === "mzArm") { armTab(tabId, msg.candidateId).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === "mzGetArm") { readArm(tabId).then((candidateId) => sendResponse({ candidateId })); return true; }
  if (msg.type === "mzDisarm") { disarmTab(tabId).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === "mzPrefill") { fetchPrefill(msg.baseUrl, msg.candidateId, sendResponse); return true; }
});
