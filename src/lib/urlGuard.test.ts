import { describe, it, expect } from "vitest";
import { isSafeExternalUrl } from "@/lib/urlGuard";

describe("isSafeExternalUrl — SSRF guard", () => {
  it("allows normal public job URLs", () => {
    for (const u of [
      "https://www.arbeitsagentur.de/jobsuche/jobdetail/123",
      "https://hotel-fulda-mitte.de/karriere",
      "http://jobs.example.com/apply?id=1",
    ]) expect(isSafeExternalUrl(u)).toBe(true);
  });

  it("blocks internal / private / metadata targets", () => {
    for (const u of [
      "http://localhost:3000/admin",
      "http://127.0.0.1/",
      "https://10.0.0.5/secrets",
      "http://192.168.1.1/router",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://postgres.railway.internal:5432/",
      "http://myservice.local/",
      "http://[::1]:8080/",
    ]) expect(isSafeExternalUrl(u)).toBe(false);
  });

  it("blocks non-http protocols and garbage", () => {
    for (const u of ["file:///etc/passwd", "ftp://x.de/", "javascript:alert(1)", "not a url", "", null, undefined]) {
      expect(isSafeExternalUrl(u as string | null | undefined)).toBe(false);
    }
  });

  it("does not block public 172.x outside the private 172.16-31 range", () => {
    expect(isSafeExternalUrl("http://172.15.0.1/")).toBe(true);
    expect(isSafeExternalUrl("http://172.32.0.1/")).toBe(true);
  });
});
