import { describe, it, expect } from "vitest";
import { familyCompatibility, occupationFamilies } from "./occupationFamily";

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

  it("keeps Omrum matched to cleaning and logistics roles he listed", () => {
    expect((familyCompatibility(OMRUM, "Reinigungskraft (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
    expect((familyCompatibility(OMRUM, "Lagerhelfer (m/w/d)") as { compatible: boolean }).compatible).toBe(true);
  });

  it("keeps a construction candidate matched to construction roles", () => {
    const r = familyCompatibility(XAZAR, "Bauleiter (m/w/d)");
    expect(r.decided).toBe(true);
    if (r.decided) expect(r.compatible).toBe(true);
  });

  it("classifies the key titles into the expected families", () => {
    expect(occupationFamilies("Technischer Objektverwalter").has("facility")).toBe(true);
    expect(occupationFamilies("Technischer Objektverwalter").has("gastro")).toBe(false);
    expect(occupationFamilies("Küchenhilfe").has("gastro")).toBe(true);
    expect(occupationFamilies("Bauleiter").has("construction")).toBe(true);
  });
});
