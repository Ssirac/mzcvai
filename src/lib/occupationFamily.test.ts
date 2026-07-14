import { describe, it, expect } from "vitest";
import { familyCompatibility, occupationFamilies } from "./occupationFamily";
import { berufMatches } from "./berufMap";

// The candidate profiles that surfaced the cross-profession bug.
const OMRUM = "Servicekraft / Allround-Mitarbeiter in Gastronomie, Hotel, Reinigung oder Logistik";
const ALYAR = "Restaurantmitarbeiter Systemgastronomie";
const FARID = "Filialleiter / Allround-Mitarbeiter";
const XAZAR = "Geschäftsführer / Bauprojektmanager, Bauleiter, Projektkoordinator, Sachbearbeiter Projektmanagement";

describe("occupation family gate", () => {
  it("blocks a gastronomy candidate from a facility role (Technischer Objektverwalter)", () => {
    for (const p of [OMRUM, ALYAR]) {
      const r = familyCompatibility(p, "Technischer Objektverwalter (m/w/d)");
      expect(r.decided).toBe(true);
      if (r.decided) expect(r.compatible).toBe(false);
    }
  });

  it("blocks a retail candidate from a construction role", () => {
    const r = familyCompatibility(FARID, "Bauleiter (m/w/d)");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(false);
  });

  it("keeps a gastronomy candidate matched to real gastronomy roles", () => {
    for (const title of ["Küchenhilfe (m/w/d)", "Restaurantfachmann", "Koch (m/w/d)", "Servicekraft"]) {
      const r = familyCompatibility(ALYAR, title);
      if (r.decided) expect(r.compatible).toBe(true);
    }
  });

  it("keeps Omrum matched to cleaning, housekeeping and logistics roles he listed", () => {
    expect((familyCompatibility(OMRUM, "Reinigungskraft (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
    expect((familyCompatibility(OMRUM, "Mitarbeiter Housekeeping (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
    expect((familyCompatibility(OMRUM, "Lagerhelfer (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
  });

  it("keeps a construction candidate matched to a facility role (same technical cluster)", () => {
    const r = familyCompatibility(XAZAR, "Technischer Objektverwalter (m/w/d)");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(true);
  });

  it("still blocks a sales/media candidate from a technical facility project lead", () => {
    const FARID = "Vertrieb, Digitale Medien & Social Media Management";
    const r = familyCompatibility(FARID, "Projektleiter Technisches Gebäudemanagement (m/w/d)");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(false);
  });

  it("keeps a construction candidate matched to construction roles", () => {
    const r = familyCompatibility(XAZAR, "Bauleiter (m/w/d)");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(true);
  });

  it("matches the sales/media candidate to sales & marketing, not construction", () => {
    const FARID = "Experte für Vertrieb, Digitale Medien & Social Media Management (SMM)";
    expect(occupationFamilies(FARID).has("sales")).toBe(true);
    expect(occupationFamilies(FARID).has("marketing")).toBe(true);
    expect((familyCompatibility(FARID, "Social Media Manager (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
    expect((familyCompatibility(FARID, "Vertriebsmitarbeiter (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
    const bau = familyCompatibility(FARID, "Bauleiter (m/w/d)");
    expect(bau.decided).toBe(true);
    if (bau.decided) expect(bau.compatible).toBe(false);
  });

  it("ignores the polluted vacancy beruf and blocks on the real title", () => {
    // A facility job ingested under a gastronomy search has beruf="Restaurant…".
    // The gate must still block it for a gastronomy candidate, using the title.
    const r = familyCompatibility(ALYAR, "Technischer Objektverwalter (m/w/d)", "Restaurantmitarbeiter Systemgastronomie");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(false);
  });

  it("does not treat a Servicetechniker (IT) as gastronomy service", () => {
    expect(occupationFamilies("Servicetechniker Telekommunikation & IT").has("gastro")).toBe(false);
    const r = familyCompatibility(ALYAR, "Servicetechniker Telekommunikation & IT (m/w/d)");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(false);
  });

  it("gives an unclassifiable off-field title no keyword overlap with a restaurant candidate", () => {
    // familyCompatibility abstains (title has no family) — the caller then relies
    // on a TITLE keyword match, which must be false for these.
    expect(familyCompatibility(ALYAR, "Operational Excellence Coordinator (gn)").decided).toBe(false);
    expect(berufMatches(ALYAR, "", "Operational Excellence Coordinator (gn)")).toBe(false);
    expect(berufMatches(ALYAR, "", "Prüfungsassistent (m/w/d)")).toBe(false);
    expect(berufMatches(ALYAR, "", "Steuerberater (m/w/d)")).toBe(false);
  });

  it("classifies the key titles into the expected families", () => {
    expect(occupationFamilies("Technischer Objektverwalter").has("facility")).toBe(true);
    expect(occupationFamilies("Technischer Objektverwalter").has("gastro")).toBe(false);
    expect(occupationFamilies("Küchenhilfe").has("gastro")).toBe(true);
    expect(occupationFamilies("Bauleiter").has("construction")).toBe(true);
  });
});
