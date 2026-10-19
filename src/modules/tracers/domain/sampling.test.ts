import { describe, expect, it } from "vitest";
import { drawSample, samplingWeights, weighCandidates, weightOf, type Candidate } from "./sampling";

const now = new Date("2026-10-19T09:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const seed = (n: number) => n.toString(16).padStart(32, "0");

describe("weightOf", () => {
  it.each<[string, Candidate, number]>([
    ["never verified or expired", { elementId: "a", state: "unverified", verifiedAt: null }, 4],
    ["short of full compliance", { elementId: "a", state: "failing", verifiedAt: daysAgo(3) }, 3],
    ["met today", { elementId: "a", state: "met", verifiedAt: now }, 1],
    ["met half a validity ago", { elementId: "a", state: "met", verifiedAt: daysAgo(45) }, 1.5],
    ["met a whole validity ago", { elementId: "a", state: "met", verifiedAt: daysAgo(90) }, 2],
    ["met longer ago still", { elementId: "a", state: "met", verifiedAt: daysAgo(400) }, 2],
  ])("%s", (_, candidate, weight) => {
    expect(weightOf(candidate, now, 90)).toBe(weight);
  });

  it("never lets an old compliant check outrank a known gap", () => {
    expect(samplingWeights.metMax).toBeLessThan(samplingWeights.failing);
    expect(samplingWeights.failing).toBeLessThan(samplingWeights.unverified);
  });
});

describe("drawSample", () => {
  const pool = ["e1", "e2", "e3", "e4", "e5", "e6"].map((elementId) => ({ elementId, weight: 1 }));

  it("draws the requested number of distinct elements from the pool", () => {
    const sample = drawSample(pool, 3, seed(7));
    expect(sample).toHaveLength(3);
    expect(new Set(sample).size).toBe(3);
    for (const id of sample) expect(pool.map((p) => p.elementId)).toContain(id);
  });

  it("takes the whole pool when it is smaller than the sample", () => {
    expect(drawSample(pool, 10, seed(1)).sort()).toEqual(pool.map((p) => p.elementId));
  });

  it("repeats exactly for the same seed, whatever order the pool arrives in", () => {
    const first = drawSample(pool, 4, seed(42));
    expect(drawSample([...pool].reverse(), 4, seed(42))).toEqual(first);
    expect(drawSample(pool, 4, seed(42))).toEqual(first);
  });

  it("changes with the seed", () => {
    const draws = new Set(
      Array.from({ length: 20 }, (_, i) => drawSample(pool, 3, seed(i + 1)).join()),
    );
    expect(draws.size).toBeGreaterThan(5);
  });

  it("refuses a malformed seed", () => {
    expect(() => drawSample(pool, 1, "not-a-seed")).toThrow("invalid seed");
  });

  it("never draws an element with no weight", () => {
    const sample = drawSample([...pool, { elementId: "zero", weight: 0 }], 7, seed(3));
    expect(sample).not.toContain("zero");
  });

  it("draws elements in proportion to their weight", () => {
    // One draw from a gap (weight 4) and a fresh compliant element (weight 1), many seeds:
    // the gap should come up about 4 times in 5.
    const candidates = [
      { elementId: "gap", weight: 4 },
      { elementId: "fresh", weight: 1 },
    ];
    const runs = 5000;
    let gaps = 0;
    for (let i = 0; i < runs; i++) {
      if (drawSample(candidates, 1, seed(i * 2654435761 + 1))[0] === "gap") gaps++;
    }
    expect(gaps / runs).toBeGreaterThan(0.77);
    expect(gaps / runs).toBeLessThan(0.83);
  });

  it("spreads draws evenly across equal weights", () => {
    const counts = new Map<string, number>();
    const runs = 6000;
    for (let i = 0; i < runs; i++) {
      const [id] = drawSample(pool, 1, seed(i * 40503 + 17));
      counts.set(id!, (counts.get(id!) ?? 0) + 1);
    }
    for (const { elementId } of pool) {
      expect(counts.get(elementId)! / runs).toBeGreaterThan(0.14);
      expect(counts.get(elementId)! / runs).toBeLessThan(0.19);
    }
  });

  it("weighs a mixed pool so that gaps dominate small samples", () => {
    const weighted = weighCandidates(
      [
        { elementId: "never", state: "unverified", verifiedAt: null },
        { elementId: "pm", state: "failing", verifiedAt: daysAgo(10) },
        { elementId: "met-old", state: "met", verifiedAt: daysAgo(80) },
        { elementId: "met-new", state: "met", verifiedAt: daysAgo(1) },
      ],
      now,
      90,
    );
    const tally = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const [id] = drawSample(weighted, 1, seed(i * 7919 + 5));
      tally.set(id!, (tally.get(id!) ?? 0) + 1);
    }
    const order = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order).toEqual(["never", "pm", "met-old", "met-new"]);
  });
});
