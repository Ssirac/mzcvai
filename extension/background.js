/**
 * Service worker — fetches candidate prefill data in the EXTENSION context.
 *
 * Why: the content script runs in the job page's origin (e.g. arbeitnow.com), so
 * its cross-site fetch to the MZ app does NOT send the mz_session cookie
 * (SameSite=Lax). A fetch from here (extension origin, with host_permissions)
 * does send the cookie — same as the popup. The content script asks us via
 * chrome.runtime.sendMessage and we relay the result.
 *
 * Self-healing base URL: if the configured base can't be reached (a common
 * mistake is leaving it on http://localhost:3000 from local testing, which has
 * no server running), we automatically retry against the production URL. So the
 * autofill works even when the popup's Base-URL is stale.
 */
const PROD_BASE = "https://mzcvai-production.up.railway.app";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "mzPrefill") {
    (async () => {
      const configured = String(msg.baseUrl || "").replace(/\/+$/, "");
      // Try the configured base first (if it's a valid absolute URL), then fall
      // back to production. De-duplicated so we don't hit the same host twice.
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
          // "Failed to fetch" = host unreachable / not in host_permissions / wrong
          // URL. Keep the reason and try the next base.
          lastErr = `${(e && e.message) || e} → ${url}`;
        }
      }
      sendResponse({ error: "network", detail: lastErr });
    })();
    return true; // keep the message channel open for the async response
  }
});
