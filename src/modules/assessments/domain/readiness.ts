// Rules 3 and 4 (ARCHITECTURE §4): whether a facility is ready for survey.

export const readinessStatuses = ["not_ready", "at_risk", "ready"] as const;
export type ReadinessStatus = (typeof readinessStatuses)[number];

/**
 * Thresholds (ARCHITECTURE decision 9 and rule 4). `readyScore` and `minStandardScore` come
 * from the edition, because each accreditation programme sets its own pass mark; these are
 * the defaults. `minStandardScore` null means the programme has no per-standard minimum.
 */
export type ReadinessSettings = {
  readyScore: number;
  maxOverdueCapa: number;
  minStandardScore: number | null;
};
export const defaultReadinessSettings: ReadinessSettings = {
  readyScore: 0.8,
  maxOverdueCapa: 5,
  minStandardScore: null,
};

export type ReadinessReason =
  | "esrNotMet"
  | "esrUnverified"
  | "scoreBelowThreshold"
  | "standardBelowMinimum"
  | "nothingToScore"
  | "overdueCapa";

export type ReadinessInput = {
  // The facility (or department) score from roll-up, 0..1, or null when nothing counts.
  score: number | null;
  esrNotMet: number;
  esrUnverified: number;
  overdueCapa: number;
  // Applicable standards whose score is below the edition's per-standard minimum.
  standardsBelowMinimum: number;
};

/**
 * `not_ready` when any ESR element is not met or not verified (expired or never scored),
 * whatever the overall score: one failed safety requirement can fail a survey on its own.
 * Otherwise `at_risk` when the score is below the threshold, there is no score, or more
 * than the allowed number of CAPA items are overdue. Otherwise `ready`.
 * A programme with a per-standard minimum (a surveyor denies accreditation when any one
 * standard scores too low, however good the total) adds that as an at-risk reason.
 * When an edition turns off `any_not_met_blocks_readiness`, ESR failures make the facility
 * at risk instead of not ready. The reasons are returned so the screen can say why.
 */
export function readinessStatus(
  input: ReadinessInput,
  settings: ReadinessSettings,
  esr: { anyNotMetBlocksReadiness: boolean },
): { status: ReadinessStatus; reasons: ReadinessReason[] } {
  const reasons: ReadinessReason[] = [];
  if (input.esrNotMet > 0) reasons.push("esrNotMet");
  if (input.esrUnverified > 0) reasons.push("esrUnverified");
  const esrFails = reasons.length > 0;
  if (input.score === null) reasons.push("nothingToScore");
  else if (input.score < settings.readyScore - 1e-9) reasons.push("scoreBelowThreshold");
  if (input.standardsBelowMinimum > 0) reasons.push("standardBelowMinimum");
  if (input.overdueCapa > settings.maxOverdueCapa) reasons.push("overdueCapa");

  if (esrFails && esr.anyNotMetBlocksReadiness) return { status: "not_ready", reasons };
  return { status: reasons.length > 0 ? "at_risk" : "ready", reasons };
}

/** The edition's stored `rollup_config.readiness` (validated at import) as settings. */
export function readinessSettingsFrom(config: {
  readiness: { ready_score: number; min_standard_score: number | null };
}): ReadinessSettings {
  return {
    ...defaultReadinessSettings,
    readyScore: config.readiness.ready_score,
    minStandardScore: config.readiness.min_standard_score,
  };
}

/**
 * How many standards score below the per-standard minimum. A standard with nothing that
 * counts (null) is left out; one nobody has verified scores 0, so it counts (rule 2).
 */
export function countStandardsBelowMinimum(
  standards: Iterable<{ score: number | null }>,
  minStandardScore: number | null,
): number {
  if (minStandardScore === null) return 0;
  let count = 0;
  for (const s of standards) if (s.score !== null && s.score < minStandardScore - 1e-9) count++;
  return count;
}
