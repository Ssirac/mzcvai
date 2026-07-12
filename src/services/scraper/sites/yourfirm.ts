/**
 * Yourfirm.de adapter (Group B — Mittelstand companies). Same styled-components
 * engine as Stellenanzeigen.de (identical card markup + data-testid hooks). Job
 * search: /stellenangebote/?fulltext=…; the unique id is the yf-##### ref in the
 * /job/… link. robots.txt disallows only offset-paginated URLs, not the first
 * result page — which is all we scrape.
 */

import { makeSzAdapter } from "./szEngine";

export const yourfirmAdapter = makeSzAdapter({
  id: "yourfirm",
  label: "Yourfirm (Scraping — Mittelstand)",
  category: "general",
  base: "https://www.yourfirm.de",
  searchPath: "/stellenangebote/",
});
