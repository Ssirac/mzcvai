/**
 * Shared robots.txt gate. Fetches a site's robots.txt and decides whether the
 * generic user-agent ("*") may crawl a given path. Fail-OPEN on any network
 * error — a transient fetch failure must not silently disable a working scraper;
 * only an explicit Disallow blocks. Used by every scraper adapter.
 */

export async function robotsAllows(base: string, path: string): Promise<boolean> {
  const root = base.replace(/\/+$/, "");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${root}/robots.txt`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return true; // no readable robots.txt → assume allowed
    const text = (await res.text()).toLowerCase();

    // Collect the Disallow rules that apply to the generic "*" agent group(s).
    const lines = text.split("\n").map((l) => l.trim());
    let inStar = false;
    const disallows: string[] = [];
    for (const line of lines) {
      if (line.startsWith("user-agent:")) { inStar = line.includes("*"); continue; }
      if (inStar && line.startsWith("disallow:")) {
        const p = line.replace("disallow:", "").trim();
        if (p) disallows.push(p);
      }
    }
    const target = path.toLowerCase();
    // Proper robots matching: a Disallow is a PREFIX pattern where `*` is any
    // sequence and a trailing `$` anchors the end. A naive stem check wrongly
    // blocks e.g. "/stellenangebote/" against a "/stellenangebote*offset=" rule
    // (which only targets offset-paginated URLs). Build a prefix-anchored regex.
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !disallows.some((rule) => {
      let pat = rule;
      const anchorEnd = pat.endsWith("$");
      if (anchorEnd) pat = pat.slice(0, -1);
      if (pat === "") return false;
      const re = new RegExp("^" + pat.split("*").map(esc).join(".*") + (anchorEnd ? "$" : ""));
      return re.test(target);
    });
  } catch {
    return true; // fail-open on our own network trouble
  }
}
