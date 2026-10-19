// Where a facility stands in its accreditation cycle (ARCHITECTURE §3.2). Dates are calendar
// days in Riyadh, passed as "YYYY-MM-DD" strings so no time zone can shift them.

export const accreditationStatuses = [
  "never_surveyed",
  "accredited",
  "conditional",
  "not_accredited",
  "expired",
] as const;
export type AccreditationStatus = (typeof accreditationStatuses)[number];

// Accreditation is normally granted for three years, so the next full survey is expected
// three years after the last one. Only a suggestion: the facility enters the date it was given.
export const accreditationYears = 3;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
  return date.toISOString().slice(0, 10) === value;
}

/** The suggested next survey date. 29 February rolls to 28 February in a common year. */
export function suggestNextSurvey(lastSurveyOn: string): string {
  const [y, m, d] = lastSurveyOn.split("-").map(Number) as [number, number, number];
  const year = y + accreditationYears;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export type SurveyCycleInput = {
  status: AccreditationStatus;
  lastSurveyOn: string | null;
  nextExpectedOn: string | null;
};

export type SurveyCycleProblem =
  | "invalidDate"
  | "nextBeforeLast"
  | "lastInFuture"
  | "lastSurveyRequired"
  | "lastSurveyNotExpected";

/**
 * Checks that the dates tell a consistent story. `today` is the Riyadh calendar day.
 * A facility that has been surveyed must say when; one never surveyed cannot have a date.
 */
export function surveyCycleProblem(
  input: SurveyCycleInput,
  today: string,
): SurveyCycleProblem | null {
  const { status, lastSurveyOn, nextExpectedOn } = input;
  if (
    (lastSurveyOn && !isCalendarDay(lastSurveyOn)) ||
    (nextExpectedOn && !isCalendarDay(nextExpectedOn))
  ) {
    return "invalidDate";
  }
  if (status === "never_surveyed" && lastSurveyOn) return "lastSurveyNotExpected";
  if (status !== "never_surveyed" && !lastSurveyOn) return "lastSurveyRequired";
  if (lastSurveyOn && lastSurveyOn > today) return "lastInFuture";
  if (lastSurveyOn && nextExpectedOn && nextExpectedOn <= lastSurveyOn) return "nextBeforeLast";
  return null;
}
