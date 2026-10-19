import { describe, expect, it } from "vitest";
import {
  currentLevels,
  elementState,
  statusUpdatesOnSubmit,
  type ElementStatusRecord,
} from "./element-status";

const at = (iso: string) => new Date(iso);
const record = (over: Partial<ElementStatusRecord>): ElementStatusRecord => ({
  elementId: "e1",
  source: "internal",
  scoreId: "old",
  levelCode: "NM",
  verifiedAt: at("2026-08-01T08:00:00Z"),
  expiresAt: at("2026-10-30T08:00:00Z"),
  ...over,
});

describe("statusUpdatesOnSubmit", () => {
  it("creates a status for a first score, expiring 90 days after it was recorded", () => {
    const updates = statusUpdatesOnSubmit({
      source: "internal",
      scores: [
        { elementId: "e1", scoreId: "s1", levelCode: "MET", scoredAt: at("2026-10-01T08:00:00Z") },
      ],
      current: [],
    });
    expect(updates).toEqual([
      {
        elementId: "e1",
        source: "internal",
        scoreId: "s1",
        levelCode: "MET",
        verifiedAt: at("2026-10-01T08:00:00Z"),
        expiresAt: at("2026-12-30T08:00:00Z"),
      },
    ]);
  });

  it("replaces an older score", () => {
    const [update] = statusUpdatesOnSubmit({
      source: "internal",
      scores: [
        { elementId: "e1", scoreId: "s2", levelCode: "MET", scoredAt: at("2026-10-01T08:00:00Z") },
      ],
      current: [record({})],
    });
    expect(update).toMatchObject({ scoreId: "s2", levelCode: "MET" });
  });

  it("does not let a late-submitted older score roll the element back", () => {
    expect(
      statusUpdatesOnSubmit({
        source: "internal",
        scores: [
          { elementId: "e1", scoreId: "s0", levelCode: "NM", scoredAt: at("2026-07-01T08:00:00Z") },
        ],
        current: [record({ scoreId: "newer", levelCode: "MET" })],
      }),
    ).toEqual([]);
  });

  it("keeps the consultant series apart from the internal one", () => {
    const updates = statusUpdatesOnSubmit({
      source: "consultant",
      scores: [
        { elementId: "e1", scoreId: "c1", levelCode: "PM", scoredAt: at("2026-07-01T08:00:00Z") },
      ],
      // A newer internal score must not block, nor be replaced by, the consultant's.
      current: [record({ verifiedAt: at("2026-09-01T08:00:00Z") })],
    });
    expect(updates).toEqual([
      expect.objectContaining({ source: "consultant", scoreId: "c1", expiresAt: null }),
    ]);
  });

  it("takes the newest of several scores for one element in one submission", () => {
    const updates = statusUpdatesOnSubmit({
      source: "internal",
      scores: [
        {
          elementId: "e1",
          scoreId: "late",
          levelCode: "MET",
          scoredAt: at("2026-10-02T08:00:00Z"),
        },
        {
          elementId: "e1",
          scoreId: "early",
          levelCode: "NM",
          scoredAt: at("2026-10-01T08:00:00Z"),
        },
      ],
      current: [],
    });
    expect(updates.map((u) => u.scoreId)).toEqual(["late"]);
  });

  it("skips a score that is already the current status", () => {
    expect(
      statusUpdatesOnSubmit({
        source: "internal",
        scores: [
          {
            elementId: "e1",
            scoreId: "old",
            levelCode: "NM",
            scoredAt: at("2026-08-01T08:00:00Z"),
          },
        ],
        current: [record({})],
      }),
    ).toEqual([]);
  });

  it("uses the tenant's validity period", () => {
    const [update] = statusUpdatesOnSubmit({
      source: "internal",
      scores: [
        { elementId: "e1", scoreId: "s", levelCode: "MET", scoredAt: at("2026-10-01T08:00:00Z") },
      ],
      current: [],
      validityDays: 30,
    });
    expect(update!.expiresAt).toEqual(at("2026-10-31T08:00:00Z"));
  });
});

describe("elementState and currentLevels", () => {
  const now = at("2026-10-19T12:00:00Z");
  const records = [
    record({ elementId: "fresh", levelCode: "MET" }),
    record({ elementId: "stale", levelCode: "MET", expiresAt: at("2026-10-19T11:59:59Z") }),
    record({ elementId: "consultant", source: "consultant", levelCode: "PM", expiresAt: null }),
  ];

  it.each([
    ["fresh", "current"],
    ["stale", "expired"],
    ["missing", "never"],
  ])("%s → %s", (id, expected) => {
    expect(
      elementState(
        records.find((r) => r.elementId === id),
        now,
      ),
    ).toBe(expected);
  });

  it("gives roll-up the current internal levels, with expired ones as unverified", () => {
    expect([...currentLevels(records, "internal", now)]).toEqual([
      ["fresh", "MET"],
      ["stale", null],
    ]);
    expect([...currentLevels(records, "consultant", now)]).toEqual([["consultant", "PM"]]);
  });
});
