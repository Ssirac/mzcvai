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
      const base = String(msg.baseUrl || "").replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(base)) {
        return sendResponse({ error: "badurl", detail: base || "(leer)" });
      }
      const url = `${base}/api/candidates/${msg.candidateId}/prefill`;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (res.status === 401) return sendResponse({ error: "unauth" });
        if (!res.ok) return sendResponse({ error: "http_" + res.status });
        sendResponse({ data: await res.json() });
      } catch (e) {
        // Surface the real reason (e.g. "Failed to fetch" = host not in
        // host_permissions / wrong URL / server unreachable) so it's diagnosable.
        sendResponse({ error: "network", detail: `${(e && e.message) || e} → ${url}` });
      }
    })();
    return true; // keep the message channel open for the async response
  }
});
