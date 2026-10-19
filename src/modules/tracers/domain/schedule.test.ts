import { describe, expect, it } from "vitest";
import { addPeriod, dueState, nextDueOn } from "./schedule";

describe("addPeriod", () => {
  it.each([
    ["2026-10-19", "weekly", "2026-10-26"],
    ["2026-12-29", "weekly", "2027-01-05"],
    ["2026-10-19", "monthly", "2026-11-19"],
    ["2026-01-31", "monthly", "2026-02-28"],
    ["2028-01-31", "monthly", "2028-02-29"],
    ["2026-12-15", "monthly", "2027-01-15"],
  ] as const)("%s + %s = %s", (day, frequency, expected) => {
    expect(addPeriod(day, frequency)).toBe(expected);
  });
});

describe("nextDueOn", () => {
  it("is due at once for a template that never ran", () => {
    expect(nextDueOn({ frequency: "weekly", createdOn: "2026-10-01", lastRunOn: null })).toBe(
      "2026-10-01",
    );
  });

  it("is one period after the last run started", () => {
    expect(
      nextDueOn({ frequency: "monthly", createdOn: "2026-01-01", lastRunOn: "2026-10-05" }),
    ).toBe("2026-11-05");
  });
});

describe("dueState", () => {
  it.each([
    ["2026-10-26", "weekly", "2026-10-25", "notDue"],
    ["2026-10-26", "weekly", "2026-10-26", "due"],
    ["2026-10-26", "weekly", "2026-11-01", "due"],
    ["2026-10-26", "weekly", "2026-11-02", "overdue"],
    ["2026-10-05", "monthly", "2026-11-04", "due"],
    ["2026-10-05", "monthly", "2026-11-05", "overdue"],
  ] as const)("due %s (%s), today %s: %s", (dueOn, frequency, today, expected) => {
    expect(dueState(dueOn, frequency, today)).toBe(expected);
  });
});
