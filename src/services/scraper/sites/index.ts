/**
 * Registry of all script-based (scraped) site adapters. Add a new site by
 * writing its adapter file and listing it here — the runner and the JobSource
 * bridge pick it up automatically. Ordered easiest → hardest (Group A → C).
 */

import type { ScraperAdapter } from "../types";
import { hotelcareerAdapter } from "./hotelcareer";
import { gastrojobsAdapter } from "./gastrojobs";
import { jobwareAdapter } from "./jobware";
import { stellenanzeigenAdapter } from "./stellenanzeigen";

export const SCRAPER_ADAPTERS: ScraperAdapter[] = [
  // Group A — hospitality (YourCareerGroup engine)
  hotelcareerAdapter,
  gastrojobsAdapter,
  // Group B — general boards, hospitality-filtered
  jobwareAdapter,
  stellenanzeigenAdapter,
];
