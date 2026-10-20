// When a committee should next meet (ARCHITECTURE §4, "As built in M12"). Calendar days
// travel as "YYYY-MM-DD" strings (Riyadh days), which compare correctly as text.

export const committeeFrequencies = ["monthly", "quarterly", "semiannual", "annual"] as const;
export type CommitteeFrequency = (typeof committeeFrequencies)[number];

export type MeetingDueState = "onTrack" | "dueSoon" | "overdue";

const periodMonths: Record<CommitteeFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** Days before the due day from which a meeting shows as due soon: time to call one. */
export const dueSoonDays = 14;

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole months on, kept to the last day of a shorter month (31 August → 30 November). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/**
 * The day the next meeting is due: one period after the last meeting, or one period after
 * the committee was formed when it has not met yet (a new committee needs time to convene).
 */
export function nextMeetingDueOn(input: {
  frequency: CommitteeFrequency;
  createdOn: string;
  lastHeldOn: string | null;
}): string {
  return addMonths(input.lastHeldOn ?? input.createdOn, periodMonths[input.frequency]);
}

/**
 * Overdue the day after the due day: a surveyor reading the minutes sees a missed cycle.
 * Due soon in the two weeks before, so the secretary can still call the meeting in time.
 */
export function meetingDueState(dueOn: string, today: string): MeetingDueState {
  if (today > dueOn) return "overdue";
  return today >= addDays(dueOn, -dueSoonDays) ? "dueSoon" : "onTrack";
}
