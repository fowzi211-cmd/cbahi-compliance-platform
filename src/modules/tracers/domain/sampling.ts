// Tracer sampling (ARCHITECTURE §3.3, "As built in M11"). A tracer checks a few elements on
// the floor instead of the whole framework, so which ones it checks decides what it can
// catch. The draw is random, so staff cannot prepare for a known list, but weighted toward
// the elements most likely to have slipped: never verified or expired first, then those last
// found short of full compliance, then compliant ones by how long ago they were checked.
// The seed is stored with the run, so anyone can repeat the draw and get the same sample.

export type CandidateState = "unverified" | "failing" | "met";

export type Candidate = {
  elementId: string;
  state: CandidateState;
  // When the current score was recorded; null when unverified.
  verifiedAt: Date | null;
};

export type WeightedCandidate = { elementId: string; weight: number };

export const samplingWeights = { unverified: 4, failing: 3, metMin: 1, metMax: 2 } as const;

export const sampleSizeLimits = { min: 1, max: 30 } as const;

const DAY = 86_400_000;

/**
 * How strongly an element is drawn. A met element gains weight as its check ages, reaching
 * the maximum when the score is as old as its validity, so the oldest checks come up first
 * among the compliant ones without ever outranking a known gap.
 */
export function weightOf(candidate: Candidate, now: Date, validityDays: number): number {
  if (candidate.state === "unverified") return samplingWeights.unverified;
  if (candidate.state === "failing") return samplingWeights.failing;
  const age = candidate.verifiedAt ? (now.getTime() - candidate.verifiedAt.getTime()) / DAY : 0;
  const share = Math.min(1, Math.max(0, age / validityDays));
  const { metMin, metMax } = samplingWeights;
  return Math.round((metMin + (metMax - metMin) * share) * 1000) / 1000;
}

export function weighCandidates(
  candidates: readonly Candidate[],
  now: Date,
  validityDays: number,
): WeightedCandidate[] {
  return candidates.map((c) => ({
    elementId: c.elementId,
    weight: weightOf(c, now, validityDays),
  }));
}

/** A fresh seed: 32 hex digits (128 bits). Callers pass a crypto-random source. */
export const seedPattern = /^[0-9a-f]{32}$/;

/**
 * Draws `size` distinct elements, each with probability proportional to its weight
 * (Efraimidis–Spirakis: every element gets the key ln(u)/w and the largest keys win).
 * Deterministic for a seed and a set of candidates, whatever order they arrive in. A pool
 * smaller than the sample is taken whole.
 */
export function drawSample(
  candidates: readonly WeightedCandidate[],
  size: number,
  seed: string,
): string[] {
  if (!seedPattern.test(seed)) throw new Error("invalid seed");
  const random = sfc32(seed);
  const ordered = [...candidates]
    .filter((c) => c.weight > 0)
    .sort((a, b) => (a.elementId < b.elementId ? -1 : a.elementId > b.elementId ? 1 : 0));
  const keyed = ordered.map((c) => ({
    elementId: c.elementId,
    key: Math.log(random()) / c.weight,
  }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.max(0, size)).map((k) => k.elementId);
}

/** A small, well-tested 128-bit PRNG; returns numbers strictly between 0 and 1. */
function sfc32(seed: string): () => number {
  let a = parseInt(seed.slice(0, 8), 16) >>> 0;
  let b = parseInt(seed.slice(8, 16), 16) >>> 0;
  let c = parseInt(seed.slice(16, 24), 16) >>> 0;
  let d = parseInt(seed.slice(24, 32), 16) >>> 0;
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t >>> 0;
  };
  // Warm up, so seeds that differ in a few bits do not start out correlated.
  for (let i = 0; i < 15; i++) next();
  return () => (next() + 0.5) / 4294967296;
}
