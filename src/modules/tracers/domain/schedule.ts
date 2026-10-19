// When a tracer template is due (ARCHITECTURE §4, "As built in M11"). Calendar days travel
// as "YYYY-MM-DD" strings (Riyadh days), which compare correctly as text.

export const tracerFrequencies = ["weekly", "monthly"] as const;
export type TracerFrequency = (typeof tracerFrequencies)[number];

export type TracerDueState = "notDue" | "due" | "overdue";

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** One month on, kept to the last day of a shorter month (31 January → 28 or 29 February). */
function addMonth(day: string) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export function addPeriod(day: string, frequency: TracerFrequency) {
  return frequency === "weekly" ? addDays(day, 7) : addMonth(day);
}

/**
 * The day the next run is due: one period after the last run started, or the day the
 * template was made when it has never run (a new template is due at once). A run in
 * progress counts as the last run, so starting one stops the reminder.
 */
export function nextDueOn(input: {
  frequency: TracerFrequency;
  createdOn: string;
  lastRunOn: string | null;
}): string {
  return input.lastRunOn ? addPeriod(input.lastRunOn, input.frequency) : input.createdOn;
}

/**
 * Due from the due day; overdue once a whole further period has passed without a run, which
 * means a cycle was missed.
 */
export function dueState(dueOn: string, frequency: TracerFrequency, today: string): TracerDueState {
  if (today < dueOn) return "notDue";
  return today < addPeriod(dueOn, frequency) ? "due" : "overdue";
}
