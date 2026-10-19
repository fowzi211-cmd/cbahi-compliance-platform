import { describe, expect, it } from "vitest";
import { addMonths, meetingDueState, nextMeetingDueOn, type CommitteeFrequency } from "./schedule";

describe("addMonths", () => {
  it.each([
    ["2026-01-15", 1, "2026-02-15"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-08-31", 3, "2026-11-30"],
    ["2026-11-30", 3, "2027-02-28"],
    ["2026-07-31", 6, "2027-01-31"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2026-12-15", 1, "2027-01-15"],
  ] as const)("%s + %i months is %s", (day, months, expected) => {
    expect(addMonths(day, months)).toBe(expected);
  });
});

describe("nextMeetingDueOn", () => {
  it.each<[CommitteeFrequency, string | null, string]>([
    ["monthly", null, "2026-11-10"],
    ["quarterly", null, "2027-01-10"],
    ["semiannual", null, "2027-04-10"],
    ["annual", null, "2027-10-10"],
    ["monthly", "2026-12-20", "2027-01-20"],
    ["quarterly", "2026-12-20", "2027-03-20"],
    ["semiannual", "2026-12-20", "2027-06-20"],
    ["annual", "2026-12-20", "2027-12-20"],
  ])("%s, last met %s: due %s", (frequency, lastHeldOn, expected) => {
    expect(nextMeetingDueOn({ frequency, createdOn: "2026-10-10", lastHeldOn })).toBe(expected);
  });
});

describe("meetingDueState", () => {
  it.each([
    ["2026-10-01", "onTrack"],
    ["2026-10-16", "onTrack"],
    ["2026-10-17", "dueSoon"],
    ["2026-10-31", "dueSoon"],
    ["2026-11-01", "overdue"],
    ["2027-03-01", "overdue"],
  ] as const)("due 2026-10-31, on %s: %s", (today, expected) => {
    expect(meetingDueState("2026-10-31", today)).toBe(expected);
  });
});
