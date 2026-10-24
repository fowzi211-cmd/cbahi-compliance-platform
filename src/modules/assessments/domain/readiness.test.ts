import { describe, expect, it } from "vitest";
import {
  countStandardsBelowMinimum,
  defaultReadinessSettings,
  readinessSettingsFrom,
  readinessStatus,
  type ReadinessInput,
} from "./readiness";

const blocking = { anyNotMetBlocksReadiness: true };
const good: ReadinessInput = {
  score: 0.92,
  esrNotMet: 0,
  esrUnverified: 0,
  overdueCapa: 0,
  standardsBelowMinimum: 0,
};

describe("readinessStatus", () => {
  it.each<[string, Partial<ReadinessInput>, string, string[]]>([
    ["all good", {}, "ready", []],
    ["exactly at the threshold", { score: 0.8 }, "ready", []],
    ["just below the threshold", { score: 0.799 }, "at_risk", ["scoreBelowThreshold"]],
    ["5 overdue CAPA items is the limit", { overdueCapa: 5 }, "ready", []],
    ["more than 5 overdue CAPA items", { overdueCapa: 6 }, "at_risk", ["overdueCapa"]],
    ["nothing to score", { score: null }, "at_risk", ["nothingToScore"]],
    [
      "an ESR element not met, even at 100%",
      { score: 1, esrNotMet: 1 },
      "not_ready",
      ["esrNotMet"],
    ],
    [
      "an ESR element expired or never scored",
      { esrUnverified: 2 },
      "not_ready",
      ["esrUnverified"],
    ],
    [
      "a standard below the per-standard minimum, however good the total",
      { score: 0.95, standardsBelowMinimum: 1 },
      "at_risk",
      ["standardBelowMinimum"],
    ],
    [
      "every reason at once",
      { score: 0.5, esrNotMet: 1, esrUnverified: 1, overdueCapa: 9, standardsBelowMinimum: 2 },
      "not_ready",
      ["esrNotMet", "esrUnverified", "scoreBelowThreshold", "standardBelowMinimum", "overdueCapa"],
    ],
  ])("%s", (_, over, status, reasons) => {
    expect(readinessStatus({ ...good, ...over }, defaultReadinessSettings, blocking)).toEqual({
      status,
      reasons,
    });
  });

  it("uses the given thresholds", () => {
    const strict = { readyScore: 0.95, maxOverdueCapa: 0, minStandardScore: null };
    expect(readinessStatus(good, strict, blocking).reasons).toEqual(["scoreBelowThreshold"]);
    expect(readinessStatus({ ...good, score: 1, overdueCapa: 1 }, strict, blocking)).toEqual({
      status: "at_risk",
      reasons: ["overdueCapa"],
    });
  });

  it("makes ESR failures 'at risk' when the edition does not let them block", () => {
    expect(
      readinessStatus({ ...good, esrNotMet: 1 }, defaultReadinessSettings, {
        anyNotMetBlocksReadiness: false,
      }),
    ).toEqual({ status: "at_risk", reasons: ["esrNotMet"] });
  });
});

describe("readinessSettingsFrom", () => {
  it("takes the pass mark and the per-standard minimum from the edition", () => {
    expect(
      readinessSettingsFrom({ readiness: { ready_score: 0.75, min_standard_score: 0.5 } }),
    ).toEqual({ readyScore: 0.75, maxOverdueCapa: 5, minStandardScore: 0.5 });
  });
});

describe("countStandardsBelowMinimum", () => {
  const standards = [{ score: 0.49 }, { score: 0.5 }, { score: null }, { score: 0 }, { score: 1 }];
  it.each<[string, number | null, number]>([
    ["no minimum counts nothing", null, 0],
    ["exactly at the minimum passes; null (nothing counts) is left out", 0.5, 2],
    ["a minimum of 0 fails nothing", 0, 0],
    ["a minimum of 1 fails every standard not fully met", 1, 3],
  ])("%s", (_, minimum, expected) => {
    expect(countStandardsBelowMinimum(standards, minimum)).toBe(expected);
  });
});
