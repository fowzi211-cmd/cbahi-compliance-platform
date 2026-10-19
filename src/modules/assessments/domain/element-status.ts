import { isExpired, scoreExpiresAt, type ScoreSource } from "./expiry";

// `ElementStatus` keeps the latest verified score of each element, one series per source.
// Decision 7: a consultant's score never overwrites the internal one; both are kept and the
// gap between them is shown.

export type ElementStatusRecord = {
  elementId: string;
  source: ScoreSource;
  scoreId: string;
  levelCode: string;
  // When the score was recorded (server time). Expiry runs from here: an observation made
  // weeks before the assessment was submitted is that old, not fresh.
  verifiedAt: Date;
  expiresAt: Date | null;
};

export type SubmittedScore = {
  elementId: string;
  scoreId: string;
  levelCode: string;
  scoredAt: Date;
};

/**
 * The status rows to write when an assessment is submitted. A score replaces the current
 * status of its element in the same series unless that status comes from a newer score, so
 * submitting an old draft late cannot roll the facility back. Returns only rows that change.
 */
export function statusUpdatesOnSubmit(input: {
  source: ScoreSource;
  scores: readonly SubmittedScore[];
  current: readonly ElementStatusRecord[];
  validityDays?: number;
}): ElementStatusRecord[] {
  const current = new Map(
    input.current.filter((s) => s.source === input.source).map((s) => [s.elementId, s]),
  );
  const updates = new Map<string, ElementStatusRecord>();
  for (const score of input.scores) {
    const existing = updates.get(score.elementId) ?? current.get(score.elementId);
    if (existing && existing.verifiedAt.getTime() > score.scoredAt.getTime()) continue;
    if (existing?.scoreId === score.scoreId) continue;
    updates.set(score.elementId, {
      elementId: score.elementId,
      source: input.source,
      scoreId: score.scoreId,
      levelCode: score.levelCode,
      verifiedAt: score.scoredAt,
      expiresAt: scoreExpiresAt(score.scoredAt, input.source, input.validityDays),
    });
  }
  return [...updates.values()];
}

export type ElementState = "current" | "expired" | "never";

export function elementState(record: ElementStatusRecord | undefined, now: Date): ElementState {
  if (!record) return "never";
  return isExpired(record.expiresAt, now) ? "expired" : "current";
}

/**
 * The level each element has in one series right now, for roll-up: null when it was never
 * scored or its score expired.
 */
export function currentLevels(
  records: readonly ElementStatusRecord[],
  source: ScoreSource,
  now: Date,
): Map<string, string | null> {
  const levels = new Map<string, string | null>();
  for (const record of records) {
    if (record.source !== source) continue;
    levels.set(record.elementId, elementState(record, now) === "current" ? record.levelCode : null);
  }
  return levels;
}
