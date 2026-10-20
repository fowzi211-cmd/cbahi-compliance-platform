import { describe, expect, it } from "vitest";
import { daysUntil, surveyCountdown } from "./countdown";

describe("daysUntil", () => {
  it.each([
    ["2026-10-20", "2026-10-20", 0],
    ["2026-10-20", "2026-10-21", 1],
    ["2026-10-20", "2026-10-19", -1],
    ["2026-12-31", "2027-01-01", 1],
    ["2028-02-28", "2028-03-01", 2],
  ] as const)("%s → %s is %i days", (today, day, expected) => {
    expect(daysUntil(today, day)).toBe(expected);
  });
});

describe("surveyCountdown", () => {
  it.each([
    [null, "unknown", null],
    ["2026-10-19", "passed", -1],
    ["2026-10-20", "imminent", 0],
    ["2026-11-19", "imminent", 30],
    ["2026-11-20", "soon", 31],
    ["2027-01-18", "soon", 90],
    ["2027-01-19", "later", 91],
  ] as const)("survey on %s: %s", (next, state, days) => {
    expect(surveyCountdown(next, "2026-10-20")).toEqual({ state, days });
  });
});
