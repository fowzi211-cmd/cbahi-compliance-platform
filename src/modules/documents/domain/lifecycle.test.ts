import { describe, expect, it } from "vitest";
import { decisionProblem, isCitable, versionDatesProblem, versionState } from "./lifecycle";

describe("versionDatesProblem", () => {
  it.each([
    [{ effectiveOn: null, reviewOn: null, expiresOn: null }, null],
    [{ effectiveOn: "2026-01-01", reviewOn: "2027-01-01", expiresOn: "2028-01-01" }, null],
    [{ effectiveOn: "2026-01-01", reviewOn: "2027-01-01", expiresOn: "2027-01-01" }, null],
    [
      { effectiveOn: "2026-01-01", reviewOn: "2026-01-01", expiresOn: null },
      "reviewBeforeEffective",
    ],
    [
      { effectiveOn: "2026-01-01", reviewOn: null, expiresOn: "2025-12-31" },
      "expiryBeforeEffective",
    ],
    [{ effectiveOn: null, reviewOn: "2027-06-01", expiresOn: "2027-01-01" }, "expiryBeforeReview"],
  ] as const)("%o → %s", (dates, expected) => {
    expect(versionDatesProblem(dates)).toBe(expected);
  });
});

describe("decisionProblem", () => {
  it.each([
    ["in_review", "approved", null, null],
    ["in_review", "rejected", "Section 3 is out of date.", null],
    ["in_review", "rejected", "  ", "commentRequired"],
    ["approved", "approved", null, "notInReview"],
    ["rejected", "approved", null, "notInReview"],
    ["superseded", "rejected", "x", "notInReview"],
  ] as const)("%s + %s → %s", (status, decision, comment, expected) => {
    expect(decisionProblem(status, decision, comment)).toBe(expected);
  });
});

describe("versionState and isCitable", () => {
  const approved = { status: "approved", reviewOn: "2027-01-01", expiresOn: "2027-06-30" } as const;
  it.each([
    [approved, "2026-10-19", "current", true],
    [approved, "2027-01-01", "reviewDue", true],
    [approved, "2027-06-30", "reviewDue", true],
    [approved, "2027-07-01", "expired", false],
    [{ status: "approved", reviewOn: null, expiresOn: null }, "2099-01-01", "current", true],
    [{ ...approved, status: "in_review" }, "2026-10-19", "pending", false],
    [{ ...approved, status: "rejected" }, "2026-10-19", "rejected", false],
    [{ ...approved, status: "superseded" }, "2026-10-19", "superseded", false],
  ] as const)("%o on %s → %s", (version, today, state, citable) => {
    expect(versionState(version, today)).toBe(state);
    expect(isCitable(version, false, today)).toBe(citable);
  });

  it("a retired document is never citable", () => {
    expect(isCitable(approved, true, "2026-10-19")).toBe(false);
  });
});
