// Rule 6 (ARCHITECTURE §4): a level that generates findings (NM and PM by default) raises
// one automatically when the assessment is submitted.

export const findingSeverities = ["esr", "high", "medium", "low"] as const;
export type FindingSeverity = (typeof findingSeverities)[number];

export const findingStatuses = ["open", "in_progress", "closed", "verified"] as const;
export type FindingStatus = (typeof findingStatuses)[number];

/**
 * An ESR gap is always `esr`: one can fail a survey on its own. Otherwise a level with no
 * compliance at all is `high` and partial compliance is `medium`. `low` is left for findings
 * people raise by hand (tracers, mock surveys).
 * `normalized` is the level as a fraction of full compliance (0..1).
 */
export function findingSeverity(input: { isEsr: boolean; normalized: number }): FindingSeverity {
  if (input.isEsr) return "esr";
  return input.normalized <= 0 ? "high" : "medium";
}
