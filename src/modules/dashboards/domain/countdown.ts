// The survey countdown on the dashboard (ARCHITECTURE §4, "As built in M13"). Calendar days
// travel as "YYYY-MM-DD" strings (Riyadh days).

export type CountdownState = "unknown" | "later" | "soon" | "imminent" | "passed";

/** Within this many days the survey is close enough that readiness gaps need a plan now. */
export const surveySoonDays = 90;
/** Within this many days there is time only for last checks. */
export const surveyImminentDays = 30;

const dayMs = 86_400_000;

export function daysUntil(today: string, day: string) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
}

/**
 * Days left until the expected survey and how urgent that is. A date already behind us
 * means the cycle record needs updating (the survey happened, or was moved).
 */
export function surveyCountdown(
  nextExpectedOn: string | null,
  today: string,
): { state: CountdownState; days: number | null } {
  if (!nextExpectedOn) return { state: "unknown", days: null };
  const days = daysUntil(today, nextExpectedOn);
  if (days < 0) return { state: "passed", days };
  if (days <= surveyImminentDays) return { state: "imminent", days };
  if (days <= surveySoonDays) return { state: "soon", days };
  return { state: "later", days };
}
