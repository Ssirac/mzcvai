/**
 * Gastrojobs.de adapter (Group A — hospitality, ~8.250+ listings). Same
 * YourCareerGroup engine as Hotelcareer (identical markup, /jobs/{slug} URLs, and
 * even shared job IDs — cross-source duplicates are collapsed by contentHash).
 */

import { makeYcgAdapter } from "./ycgEngine";

export const gastrojobsAdapter = makeYcgAdapter({
  id: "gastrojobs",
  label: "Gastrojobs (Scraping — Gastronomie)",
  base: "https://www.gastrojobs.de",
});
