/**
 * Auto-ingest: when a candidate's profession has no jobs in the DB yet, fetch
 * them on demand from the FAST legal sources (Adzuna + Arbeitnow) so every
 * candidate gets matches without a manual ingest step. Bundesagentur is skipped
 * here because its per-job detail fetch is slow; run it manually for depth.
 */

import { ingestAdzuna } from "@/services/adzuna";
import { ingestArbeitnow } from "@/services/arbeitnow";
import { ingestJooble } from "@/services/jooble";
import { scoreEmployersForSearch } from "@/services/scoring";

// Turn a free-text beruf into clean search terms. Compound titles like
// "Geschäftsführer / Bauprojektmanager" are split into their parts so each is
// searched separately (the full phrase rarely returns results).
function searchTermsForBeruf(beruf: string): string[] {
  const parts = beruf
    .split(/\s*[/,;&]\s*|\s+und\s+|\s+oder\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  const terms = parts.length ? parts : [beruf.trim()];
  // De-dupe, keep at most 2 to stay fast
  return Array.from(new Set(terms)).slice(0, 2);
}

export async function autoIngestForBeruf(beruf: string, region: string): Promise<{ vacanciesNew: number; sources: string[]; terms: string[] }> {
  let vacanciesNew = 0;
  const sources = new Set<string>();
  const terms = searchTermsForBeruf(beruf);

  for (const term of terms) {
    // Adzuna — fast aggregator (covers many boards + company pages)
    try {
      const r = await ingestAdzuna({ beruf: term, region, maxPages: 4 });
      vacanciesNew += r.vacanciesNew;
      if (r.vacanciesNew > 0) sources.add("adzuna");
    } catch { /* non-fatal */ }

    // Arbeitnow — fast, visa-friendly
    try {
      const r = await ingestArbeitnow({ beruf: term, region, maxPages: 4 });
      vacanciesNew += r.vacanciesNew;
      if (r.vacanciesNew > 0) sources.add("arbeitnow");
    } catch { /* non-fatal */ }

    // Jooble — only if a key is configured
    if (process.env.JOOBLE_API_KEY) {
      try {
        const r = await ingestJooble({ beruf: term, region, maxPages: 3 });
        vacanciesNew += r.vacanciesNew;
        if (r.vacanciesNew > 0) sources.add("jooble");
      } catch { /* non-fatal */ }
    }
  }

  if (vacanciesNew > 0) {
    // Score against each term so the candidate's employers get ranked
    for (const term of terms) await scoreEmployersForSearch(term, region);
  }
  return { vacanciesNew, sources: Array.from(sources), terms };
}
