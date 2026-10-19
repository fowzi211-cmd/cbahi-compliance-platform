import { describe, expect, it } from "vitest";
import { isCalendarDay, suggestNextSurvey, surveyCycleProblem } from "./survey-cycle";

describe("isCalendarDay", () => {
  it.each([
    ["2026-10-19", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-1-01", false],
    ["19/10/2026", false],
  ])("%s → %s", (value, expected) => {
    expect(isCalendarDay(value)).toBe(expected);
  });
});

describe("suggestNextSurvey", () => {
  it.each([
    ["2026-10-19", "2029-10-19"],
    ["2024-02-29", "2027-02-28"],
    ["2025-12-31", "2028-12-31"],
  ])("%s → %s", (last, expected) => {
    expect(suggestNextSurvey(last)).toBe(expected);
  });
});

describe("surveyCycleProblem", () => {
  const today = "2026-10-19";
  it.each([
    [
      "never surveyed, no dates",
      { status: "never_surveyed", lastSurveyOn: null, nextExpectedOn: null },
      null,
    ],
    [
      "never surveyed, first survey booked",
      { status: "never_surveyed", lastSurveyOn: null, nextExpectedOn: "2027-03-01" },
      null,
    ],
    [
      "accredited with dates",
      { status: "accredited", lastSurveyOn: "2025-05-01", nextExpectedOn: "2028-05-01" },
      null,
    ],
    ["surveyed today", { status: "conditional", lastSurveyOn: today, nextExpectedOn: null }, null],
    [
      "never surveyed but a last date",
      { status: "never_surveyed", lastSurveyOn: "2025-05-01", nextExpectedOn: null },
      "lastSurveyNotExpected",
    ],
    [
      "accredited without a last date",
      { status: "accredited", lastSurveyOn: null, nextExpectedOn: "2028-05-01" },
      "lastSurveyRequired",
    ],
    [
      "last survey in the future",
      { status: "accredited", lastSurveyOn: "2026-10-20", nextExpectedOn: null },
      "lastInFuture",
    ],
    [
      "next before last",
      { status: "expired", lastSurveyOn: "2023-01-01", nextExpectedOn: "2022-12-31" },
      "nextBeforeLast",
    ],
    [
      "next on the same day",
      { status: "expired", lastSurveyOn: "2023-01-01", nextExpectedOn: "2023-01-01" },
      "nextBeforeLast",
    ],
    [
      "impossible date",
      { status: "accredited", lastSurveyOn: "2025-02-30", nextExpectedOn: null },
      "invalidDate",
    ],
  ] as const)("%s → %s", (_, input, expected) => {
    expect(surveyCycleProblem(input, today)).toBe(expected);
  });
});
