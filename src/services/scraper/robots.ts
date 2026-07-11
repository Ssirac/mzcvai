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
    // A rule blocks us if the target path starts with the (wildcard-trimmed) rule.
    return !disallows.some((rule) => {
      const stem = rule.split("*")[0];
      return stem !== "" && target.startsWith(stem);
    });
  } catch {
    return true; // fail-open on our own network trouble
  }
}
