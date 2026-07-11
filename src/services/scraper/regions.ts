/**
 * Free-text location → canonical German region (Bundesland) mapping, shared by
 * every scraper adapter so scraped jobs land in the same regional buckets the
 * API sources use. Best-effort; unknown locations fall back to "Deutschland".
 */
export function normalizeRegion(location: string | null | undefined): string {
  const i = (location ?? "").toLowerCase();
  if (i.includes("nordrhein") || i.includes("köln") || i.includes("koeln") || i.includes("düsseldorf") || i.includes("dortmund") || i.includes("essen") || i.includes("duisburg")) return "NRW";
  if (i.includes("münchen") || i.includes("munich") || i.includes("bayern") || i.includes("nürnberg") || i.includes("augsburg")) return "Bayern";
  if (i.includes("berlin")) return "Berlin";
  if (i.includes("hamburg")) return "Hamburg";
  if (i.includes("frankfurt") || i.includes("hessen") || i.includes("wiesbaden") || i.includes("kassel")) return "Hessen";
  if (i.includes("stuttgart") || i.includes("baden") || i.includes("karlsruhe") || i.includes("mannheim") || i.includes("freiburg")) return "Baden-Württemberg";
  if (i.includes("dresden") || i.includes("leipzig") || i.includes("sachsen")) return "Sachsen";
  if (i.includes("hannover") || i.includes("niedersachsen") || i.includes("osnabrück") || i.includes("braunschweig")) return "Niedersachsen";
  if (i.includes("bremen")) return "Bremen";
  if (i.includes("kiel") || i.includes("lübeck") || i.includes("schleswig")) return "Schleswig-Holstein";
  if (i.includes("mainz") || i.includes("rheinland-pfalz") || i.includes("koblenz") || i.includes("trier")) return "Rheinland-Pfalz";
  if (i.includes("saarland") || i.includes("saarbrücken")) return "Saarland";
  if (i.includes("erfurt") || i.includes("thüringen") || i.includes("thueringen")) return "Thüringen";
  if (i.includes("magdeburg") || i.includes("sachsen-anhalt") || i.includes("halle")) return "Sachsen-Anhalt";
  if (i.includes("schwerin") || i.includes("rostock") || i.includes("mecklenburg")) return "Mecklenburg-Vorpommern";
  if (i.includes("potsdam") || i.includes("brandenburg")) return "Brandenburg";
  return "Deutschland";
}
