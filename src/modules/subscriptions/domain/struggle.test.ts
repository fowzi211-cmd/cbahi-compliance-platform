import { describe, expect, it } from "vitest";
import {
  defaultStruggleSettings,
  offerAllowed,
  struggleSignal,
  type StruggleInput,
} from "./struggle";

const calm: StruggleInput = { esrNotMet: 0, overdueCapa: 0, score: 0.9, surveyInDays: null };

describe("struggleSignal", () => {
  it.each([
    ["a calm facility", {}, []],
    ["one ESR element not met", { esrNotMet: 1 }, ["esrNotMet"]],
    ["five overdue actions is still within limits", { overdueCapa: 5 }, []],
    ["six overdue actions", { overdueCapa: 6 }, ["overdueCapa"]],
    ["survey in 90 days below 80%", { surveyInDays: 90, score: 0.79 }, ["surveySoonNotReady"]],
    ["survey in 91 days below 80%", { surveyInDays: 91, score: 0.5 }, []],
    ["survey today below 80%", { surveyInDays: 0, score: 0.5 }, ["surveySoonNotReady"]],
    ["survey date passed", { surveyInDays: -1, score: 0.5 }, []],
    ["survey soon at exactly 80%", { surveyInDays: 30, score: 0.8 }, []],
    ["survey soon with nothing scored", { surveyInDays: 30, score: null }, ["surveySoonNotReady"]],
    [
      "everything at once",
      { esrNotMet: 2, overdueCapa: 9, surveyInDays: 10, score: 0.4 },
      ["esrNotMet", "overdueCapa", "surveySoonNotReady"],
    ],
  ] as const)("%s", (_, over, expected) => {
    expect(struggleSignal({ ...calm, ...over })).toEqual(expected);
  });

  it("uses the given thresholds", () => {
    const strict = { ...defaultStruggleSettings, maxOverdueCapa: 0, readyScore: 0.95 };
    expect(struggleSignal({ ...calm, overdueCapa: 1, surveyInDays: 5 }, strict)).toEqual([
      "overdueCapa",
      "surveySoonNotReady",
    ]);
  });
});

describe("offerAllowed", () => {
  const now = new Date("2026-10-20T20:55:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  it.each([
    ["no offer yet", null, true],
    ["an offer is waiting for an answer", { createdAt: daysAgo(30), waiting: true }, false],
    ["the last offer was 13 days ago", { createdAt: daysAgo(13), waiting: false }, false],
    ["the last offer was 14 days ago", { createdAt: daysAgo(14), waiting: false }, true],
  ] as const)("%s", (_, last, expected) => {
    expect(offerAllowed(last, now)).toBe(expected);
  });
});
