/**
 * Service worker — fetches candidate prefill data in the EXTENSION context.
 *
 * Why: the content script runs in the job page's origin (e.g. arbeitnow.com), so
 * its cross-site fetch to the MZ app does NOT send the mz_session cookie
 * (SameSite=Lax). A fetch from here (extension origin, with host_permissions)
 * does send the cookie — same as the popup. The content script asks us via
 * chrome.runtime.sendMessage and we relay the result.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "mzPrefill") {
    (async () => {
      try {
        const base = String(msg.baseUrl || "").replace(/\/+$/, "");
        const res = await fetch(`${base}/api/candidates/${msg.candidateId}/prefill`, { credentials: "include" });
        if (res.status === 401) return sendResponse({ error: "unauth" });
        if (!res.ok) return sendResponse({ error: "http_" + res.status });
        sendResponse({ data: await res.json() });
      } catch {
        sendResponse({ error: "network" });
      }
    })();
    return true; // keep the message channel open for the async response
  }
});
