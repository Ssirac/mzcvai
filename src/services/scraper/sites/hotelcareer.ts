/**
 * Hotelcareer.de adapter (Group A — hospitality). Runs on the YourCareerGroup
 * engine, so it's a one-line call to the shared factory. See ycgEngine.ts.
 */

import { makeYcgAdapter } from "./ycgEngine";

export const hotelcareerAdapter = makeYcgAdapter({
  id: "hotelcareer",
  label: "Hotelcareer (Scraping — Hotel & Gastronomie)",
  base: "https://www.hotelcareer.de",
});
