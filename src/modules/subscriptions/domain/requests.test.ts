import { describe, expect, it } from "vitest";
import { facilityTransition, platformTransition, requestStatuses } from "./requests";

describe("facilityTransition", () => {
  it.each([
    ["offered", "accept", "open"],
    ["offered", "dismiss", "dismissed"],
    ["open", "cancel", "cancelled"],
    ["open", "accept", null],
    ["in_progress", "cancel", null],
    ["done", "cancel", null],
    ["dismissed", "accept", null],
  ] as const)("%s + %s → %s", (from, action, to) => {
    expect(facilityTransition(from, action)).toBe(to);
  });
});

describe("platformTransition", () => {
  it.each([
    ["open", "start", "in_progress"],
    ["in_progress", "complete", "done"],
    ["open", "cancel", "cancelled"],
    ["in_progress", "cancel", "cancelled"],
    ["offered", "start", null],
    ["open", "complete", null],
    ["done", "cancel", null],
  ] as const)("%s + %s → %s", (from, action, to) => {
    expect(platformTransition(from, action)).toBe(to);
  });

  it("never moves an offer: only the facility answers it", () => {
    for (const action of ["start", "complete", "cancel"] as const) {
      expect(platformTransition("offered", action)).toBeNull();
    }
    expect(requestStatuses).toContain("offered");
  });
});
