// Rules 3 and 4 (ARCHITECTURE §4): whether a facility is ready for survey.

export const readinessStatuses = ["not_ready", "at_risk", "ready"] as const;
export type ReadinessStatus = (typeof readinessStatuses)[number];

/** Per-tenant thresholds; these are the defaults (ARCHITECTURE decision 9 and rule 4). */
export type ReadinessSettings = { readyScore: number; maxOverdueCapa: number };
export const defaultReadinessSettings: ReadinessSettings = { readyScore: 0.8, maxOverdueCapa: 5 };

export type ReadinessReason =
  "esrNotMet" | "esrUnverified" | "scoreBelowThreshold" | "nothingToScore" | "overdueCapa";

export type ReadinessInput = {
  // The facility (or department) score from roll-up, 0..1, or null when nothing counts.
  score: number | null;
  esrNotMet: number;
  esrUnverified: number;
  overdueCapa: number;
};

/**
 * `not_ready` when any ESR element is not met or not verified (expired or never scored),
 * whatever the overall score: one failed safety requirement can fail a survey on its own.
 * Otherwise `at_risk` when the score is below the threshold, there is no score, or more
 * than the allowed number of CAPA items are overdue. Otherwise `ready`.
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
  if (input.overdueCapa > settings.maxOverdueCapa) reasons.push("overdueCapa");

  if (esrFails && esr.anyNotMetBlocksReadiness) return { status: "not_ready", reasons };
  return { status: reasons.length > 0 ? "at_risk" : "ready", reasons };
}
