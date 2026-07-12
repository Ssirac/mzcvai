/**
 * Stellenanzeigen.de adapter (Group B — general board). Runs on the shared
 * styled-components engine (see szEngine.ts) — one call to the factory.
 */

import { makeSzAdapter } from "./szEngine";

export const stellenanzeigenAdapter = makeSzAdapter({
  id: "stellenanzeigen",
  label: "Stellenanzeigen.de (Scraping — allgemein)",
  category: "general",
  base: "https://www.stellenanzeigen.de",
  searchPath: "/suche/",
});
