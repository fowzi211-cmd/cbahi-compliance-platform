// The scoring scale of a framework edition, as the scoring engine sees it. Mirrors the
// library's `score_level` rows; this module keeps its own type because `domain/` imports
// nothing from other modules.

export type ScoreLevel = {
  code: string;
  value: number;
  // False for "Not applicable": the element drops out of the denominator.
  countsInDenominator: boolean;
  // Anti-decoration rule (ARCHITECTURE decision 7): MET and PM need evidence by default.
  requiresEvidence: boolean;
  generatesFinding: boolean;
};

export type Scale = readonly ScoreLevel[];

/** The top value among levels that count, which a score is measured against. */
export function scaleMaximum(scale: Scale): number {
  const values = scale.filter((l) => l.countsInDenominator).map((l) => l.value);
  return values.length === 0 ? 0 : Math.max(...values);
}

/**
 * A level as a fraction of full compliance (0..1), or null for a level that does not count.
 * Scales may use any numbers (0/1/2, 0/50/100); roll-up works on the normalized fraction.
 */
export function normalizedValue(level: ScoreLevel, scale: Scale): number | null {
  if (!level.countsInDenominator) return null;
  const max = scaleMaximum(scale);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, level.value / max));
}

export function findLevel(scale: Scale, code: string): ScoreLevel | undefined {
  return scale.find((l) => l.code === code);
}
