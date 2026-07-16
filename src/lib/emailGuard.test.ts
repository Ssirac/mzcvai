import { describe, it, expect } from "vitest";
import { looksPersonal, isExecLocalpart } from "@/lib/emailGuard";

describe("looksPersonal — GDPR send-guard", () => {
  it("allows plain generic company inboxes", () => {
    for (const e of ["info@firma.de", "bewerbung@hotel.de", "jobs@x.com", "karriere@y.de", "hr@z.de"]) {
      expect(looksPersonal(e)).toBe(false);
    }
  });

  it("allows generic inboxes with a branch/name suffix", () => {
    // These are real application addresses, must NOT be treated as personal.
    for (const e of ["bewerbung-felderer@x.de", "jobs-berlin@x.de", "hr-nord@x.de", "personal-hamburg@x.de"]) {
      expect(looksPersonal(e)).toBe(false);
    }
  });

  it("blocks firstname.lastname personal addresses (GDPR default)", () => {
    for (const e of ["max.mustermann@firma.de", "a.schmidt@x.de", "anna_meier@y.de", "jan-becker@z.de"]) {
      expect(looksPersonal(e)).toBe(true);
    }
  });

  it("blocks executive / owner addresses", () => {
    for (const e of ["ceo@firma.de", "inhaber@x.de", "geschaeftsfuehrer@y.de", "gf@z.de", "vorstand@a.de"]) {
      expect(looksPersonal(e)).toBe(true);
    }
  });

  it("does not misclassify legitimate roles that merely contain exec-like words", () => {
    // "chefkoch" (head chef) must stay valid — not an executive inbox.
    expect(isExecLocalpart("chefkoch")).toBe(false);
    expect(looksPersonal("chefkoch@restaurant.de")).toBe(false);
  });
});
