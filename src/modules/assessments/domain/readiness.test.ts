import { describe, expect, it } from "vitest";
import { defaultReadinessSettings, readinessStatus, type ReadinessInput } from "./readiness";

const blocking = { anyNotMetBlocksReadiness: true };
const good: ReadinessInput = { score: 0.92, esrNotMet: 0, esrUnverified: 0, overdueCapa: 0 };

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
      "every reason at once",
      { score: 0.5, esrNotMet: 1, esrUnverified: 1, overdueCapa: 9 },
      "not_ready",
      ["esrNotMet", "esrUnverified", "scoreBelowThreshold", "overdueCapa"],
    ],
  ])("%s", (_, over, status, reasons) => {
    expect(readinessStatus({ ...good, ...over }, defaultReadinessSettings, blocking)).toEqual({
      status,
      reasons,
    });
  });

  it("uses the tenant's thresholds", () => {
    const strict = { readyScore: 0.95, maxOverdueCapa: 0 };
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
