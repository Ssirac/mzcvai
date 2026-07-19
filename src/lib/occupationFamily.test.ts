import { describe, it, expect } from "vitest";
import { familyCompatibility, occupationFamilies, occupationClusters } from "./occupationFamily";
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

// The specialization anchor: logistics and IT are different clusters, so a
// logistics candidate must never be matched to an IT role and vice versa. This
// mirrors the hard core-cluster gate now enforced in matchCandidateToVacancies.
describe("occupation cluster gate (core specialization anchor)", () => {
  const shareCluster = (core: string, title: string): boolean => {
    const cc = occupationClusters(core);
    const vc = occupationClusters(title);
    if (cc.size === 0 || vc.size === 0) return true; // unclassifiable → not blocked here
    return Array.from(vc).some((c) => cc.has(c));
  };

  it("puts logistics and IT in different clusters", () => {
    expect(Array.from(occupationClusters("Lagerist")).includes("logistics")).toBe(true);
    expect(Array.from(occupationClusters("Softwareentwickler")).includes("it")).toBe(true);
    expect(occupationClusters("Kraftfahrer").has("it")).toBe(false);
  });

  it("does not tag non-software '…entwickler' roles as IT (bare 'entwickler' is too broad)", () => {
    for (const title of ["Verpackungsentwickler (m/w/d)", "Produktentwickler", "Personalentwickler", "Business Developer"]) {
      expect(occupationFamilies(title).has("it")).toBe(false);
    }
    // Real software dev titles still classify as IT.
    for (const title of ["Softwareentwickler", "Webentwickler (m/w/d)", "Anwendungsentwickler", "Fullstack Developer"]) {
      expect(occupationFamilies(title).has("it")).toBe(true);
    }
  });

  it("blocks a logistics candidate from IT roles", () => {
    for (const core of ["Lagerist", "Berufskraftfahrer", "Lagerarbeiter / Kommissionierer"]) {
      expect(shareCluster(core, "Softwareentwickler (m/w/d)")).toBe(false);
      expect(shareCluster(core, "Fachinformatiker Systemintegration")).toBe(false);
      expect(shareCluster(core, "IT-Administrator (m/w/d)")).toBe(false);
    }
  });

  it("blocks an IT candidate from logistics/warehouse roles", () => {
    for (const core of ["Softwareentwickler", "Fachinformatiker"]) {
      expect(shareCluster(core, "Lagerhelfer (m/w/d)")).toBe(false);
      expect(shareCluster(core, "Berufskraftfahrer CE (m/w/d)")).toBe(false);
    }
  });

  it("keeps a logistics candidate matched to real logistics roles", () => {
    for (const title of ["Lagerhelfer (m/w/d)", "Kommissionierer", "Staplerfahrer", "LKW-Fahrer (m/w/d)", "Produktionshelfer"]) {
      expect(shareCluster("Lagerist", title)).toBe(true);
    }
  });

  it("keeps same-cluster hospitality matches (Koch ↔ Housekeeping ↔ Reinigung)", () => {
    expect(shareCluster("Koch", "Mitarbeiter Housekeeping (m/w/d)")).toBe(true);
    expect(shareCluster("Koch", "Reinigungskraft (m/w/d)")).toBe(true);
    expect(shareCluster("Koch", "Restaurantfachmann")).toBe(true);
  });
});

describe("context-word leaks (Großküchen / Veranstaltung / Technisch)", () => {
  it("'Anlagenmonteur für Großküchen' is a trades role, NOT gastronomy", () => {
    const fams = occupationFamilies("Anlagenmonteur für Großküchen- und Speiseausgabeanlagen");
    expect(fams.has("gastro")).toBe(false); // the 'Küchen' setting must not read as a kitchen job
    expect(fams.has("trades")).toBe(true);
    // A cook must NOT match it; a real installer/technician still does.
    expect(familyCompatibility("Koch", "Anlagenmonteur für Großküchen").compatible).toBe(false);
  });

  it("a coordinator does not bridge to a cook on the shared word 'Veranstaltung'", () => {
    // Both mention Veranstaltung, but one is a Koordinator and one a Koch.
    expect(berufMatches("Veranstaltungskoordinator", "", "Bankett & Veranstaltungs Koch")).toBe(false);
    // A real cook still matches the cook role.
    expect(berufMatches("Koch", "", "Bankett & Veranstaltungs Koch")).toBe(true);
  });

  it("real kitchen roles still classify as gastronomy", () => {
    for (const t of ["Küchenhilfe (m/w/d)", "Küchenmitarbeiter", "Koch / Köchin", "Beikoch"]) {
      expect(occupationFamilies(t).has("gastro")).toBe(true);
    }
  });
});
