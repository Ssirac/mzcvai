import { describe, it, expect } from "vitest";
import { contentHash } from "./hash";

describe("contentHash — cross-source dedup key", () => {
  it("is stable across punctuation/case/whitespace differences", () => {
    const a = contentHash({ title: "Koch (m/w/d)", employer: "Hotel Adler GmbH", location: "Berlin" });
    const b = contentHash({ title: "koch m w d", employer: "hotel  adler   gmbh", location: "BERLIN" });
    expect(a).toBe(b);
  });

  it("differs when the essence differs", () => {
    const a = contentHash({ title: "Koch", employer: "Adler", location: "Berlin" });
    const b = contentHash({ title: "Koch", employer: "Adler", location: "München" });
    expect(a).not.toBe(b);
  });

  it("handles a missing location", () => {
    expect(() => contentHash({ title: "Koch", employer: "Adler" })).not.toThrow();
  });
});
