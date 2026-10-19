// Rule 5 (ARCHITECTURE §4) and decision 6: an internal score is trusted for a limited time.

export const scoreSources = ["internal", "consultant"] as const;
export type ScoreSource = (typeof scoreSources)[number];

export const defaultScoreValidityDays = 90;
const DAY_MS = 86_400_000;

/**
 * When a score stops counting. Internal scores expire `validityDays` after they were
 * verified, so compliance has to be re-checked rather than claimed once. A consultant's
 * score does not expire; it is shown with its date instead.
 */
export function scoreExpiresAt(
  verifiedAt: Date,
  source: ScoreSource,
  validityDays: number = defaultScoreValidityDays,
): Date | null {
  if (source === "consultant") return null;
  if (!Number.isInteger(validityDays) || validityDays < 1) {
    throw new Error("validityDays must be a positive whole number");
  }
  return new Date(verifiedAt.getTime() + validityDays * DAY_MS);
}

/** Expired from the expiry moment on; a score with no expiry never expires. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}
