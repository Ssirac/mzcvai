import { describe, it, expect } from "vitest";
import { cosine, embeddingsAvailable } from "./embeddings";

describe("cosine", () => {
  it("is 1 for identical direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("is scale-invariant", () => {
    expect(cosine([2, 2], [1, 1])).toBeCloseTo(1);
    expect(cosine([3, 0], [10, 0])).toBeCloseTo(1);
  });

  it("returns 0 when either vector is all-zero (no NaN)", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 1], [0, 0])).toBe(0);
  });

  it("ranks a closer vector higher", () => {
    const q = [1, 1, 0];
    const near = cosine(q, [1, 0.9, 0.1]);
    const far = cosine(q, [0, 0, 1]);
    expect(near).toBeGreaterThan(far);
  });
});

describe("embeddingsAvailable", () => {
  it("is false with no provider key configured (test env)", () => {
    // No VOYAGE_API_KEY / OPENAI_API_KEY in the test environment.
    expect(embeddingsAvailable()).toBe(false);
  });
});
