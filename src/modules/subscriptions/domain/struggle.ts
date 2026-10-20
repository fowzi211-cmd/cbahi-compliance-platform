// Rule 9 (ARCHITECTURE §4 and decision 9): when a facility is struggling, offer help.

export const struggleReasons = ["esrNotMet", "overdueCapa", "surveySoonNotReady"] as const;
export type StruggleReason = (typeof struggleReasons)[number];

export type StruggleSettings = {
  // More overdue corrective actions than this is a struggle.
  maxOverdueCapa: number;
  // A survey this close, with readiness below `readyScore`, is a struggle.
  surveyWithinDays: number;
  readyScore: number;
  // At most one offer per facility in this many days, so an offer never becomes nagging.
  offerCooldownDays: number;
};

export const defaultStruggleSettings: StruggleSettings = {
  maxOverdueCapa: 5,
  surveyWithinDays: 90,
  readyScore: 0.8,
  offerCooldownDays: 14,
};

export type StruggleInput = {
  // ESR elements scored below full compliance (not merely unverified: an element nobody has
  // scored yet is a gap in the work, not evidence that the facility is failing).
  esrNotMet: number;
  overdueCapa: number;
  // The lowest facility score across the editions it uses; null when nothing counts.
  score: number | null;
  // Days until the expected survey; null when no date is recorded.
  surveyInDays: number | null;
};

/** Why the facility is struggling; empty when it is not. */
export function struggleSignal(
  input: StruggleInput,
  settings: StruggleSettings = defaultStruggleSettings,
): StruggleReason[] {
  const reasons: StruggleReason[] = [];
  if (input.esrNotMet > 0) reasons.push("esrNotMet");
  if (input.overdueCapa > settings.maxOverdueCapa) reasons.push("overdueCapa");
  const surveySoon =
    input.surveyInDays !== null &&
    input.surveyInDays >= 0 &&
    input.surveyInDays <= settings.surveyWithinDays;
  if (surveySoon && (input.score === null || input.score < settings.readyScore - 1e-9)) {
    reasons.push("surveySoonNotReady");
  }
  return reasons;
}

const dayMs = 86_400_000;

/**
 * Whether a new offer may be made: none is waiting for an answer, and the last one (whatever
 * became of it) is at least the cool-down old.
 */
export function offerAllowed(
  last: { createdAt: Date; waiting: boolean } | null,
  now: Date,
  settings: StruggleSettings = defaultStruggleSettings,
) {
  if (!last) return true;
  if (last.waiting) return false;
  return now.getTime() - last.createdAt.getTime() >= settings.offerCooldownDays * dayMs;
}
