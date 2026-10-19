import { describe, expect, it } from "vitest";
import { isExpired, scoreExpiresAt } from "./expiry";

const verified = new Date("2026-07-01T09:30:00Z");

describe("scoreExpiresAt", () => {
  it.each([
    ["internal, default 90 days", "internal", undefined, "2026-09-29T09:30:00.000Z"],
    ["internal, 30 days", "internal", 30, "2026-07-31T09:30:00.000Z"],
    ["internal, 365 days", "internal", 365, "2027-07-01T09:30:00.000Z"],
    ["consultant never expires", "consultant", 90, null],
  ] as const)("%s", (_, source, days, expected) => {
    expect(scoreExpiresAt(verified, source, days)?.toISOString() ?? null).toBe(expected);
  });

  it.each([0, -5, 1.5, Number.NaN])("refuses a validity of %s days", (days) => {
    expect(() => scoreExpiresAt(verified, "internal", days)).toThrow();
  });
});

describe("isExpired", () => {
  const expiresAt = new Date("2026-09-29T09:30:00Z");
  it.each([
    ["a millisecond before", "2026-09-29T09:29:59.999Z", false],
    ["at the moment", "2026-09-29T09:30:00.000Z", true],
    ["after", "2026-10-19T00:00:00Z", true],
  ])("%s", (_, now, expected) => {
    expect(isExpired(expiresAt, new Date(now))).toBe(expected);
  });

  it("never expires without an expiry", () => {
    expect(isExpired(null, new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });
});
