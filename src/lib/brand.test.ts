import { describe, it, expect } from "vitest";
import { AGENCY_NAME, brandedFrom } from "@/lib/brand";

describe("brandedFrom — sender display name", () => {
  it("keeps the address but forces the brand name from a full header", () => {
    expect(brandedFrom("Old Name <info@mz-personalvermittlung.de>", "fallback@x.de"))
      .toBe(`${AGENCY_NAME} <info@mz-personalvermittlung.de>`);
  });

  it("brands a bare address", () => {
    expect(brandedFrom("info@mz-personalvermittlung.de", "fallback@x.de"))
      .toBe(`${AGENCY_NAME} <info@mz-personalvermittlung.de>`);
  });

  it("uses the fallback address when unset or empty", () => {
    const expected = `${AGENCY_NAME} <info@mz-personalvermittlung.de>`;
    expect(brandedFrom(undefined, "info@mz-personalvermittlung.de")).toBe(expected);
    expect(brandedFrom("", "info@mz-personalvermittlung.de")).toBe(expected);
  });

  it("uses the current brand", () => {
    expect(AGENCY_NAME).toBe("MZ Talent Solutions");
  });
});
