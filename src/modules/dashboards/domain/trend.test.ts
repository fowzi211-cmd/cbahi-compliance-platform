import { describe, expect, it } from "vitest";
import { trendPoints, windowStart } from "./trend";

describe("trendPoints", () => {
  it("puts both series of a day side by side, oldest first, leaving missing days out", () => {
    expect(
      trendPoints([
        { day: "2026-10-03", series: "internal", score: 0.7 },
        { day: "2026-10-01", series: "internal", score: 0.5 },
        { day: "2026-10-03", series: "consultant", score: 0.6 },
        { day: "2026-10-01", series: "consultant", score: null },
      ]),
    ).toEqual([
      { day: "2026-10-01", internal: 0.5, consultant: null },
      { day: "2026-10-03", internal: 0.7, consultant: 0.6 },
    ]);
  });

  it("is empty with no snapshots", () => {
    expect(trendPoints([])).toEqual([]);
  });
});

describe("windowStart", () => {
  it.each([
    ["2026-10-20", 1, "2026-10-20"],
    ["2026-10-20", 7, "2026-10-14"],
    ["2026-03-01", 2, "2026-02-28"],
  ] as const)("%s, %i days, starts %s", (today, days, expected) => {
    expect(windowStart(today, days)).toBe(expected);
  });
});
