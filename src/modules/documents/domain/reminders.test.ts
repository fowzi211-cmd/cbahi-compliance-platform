import { describe, expect, it } from "vitest";
import { documentReminders } from "./reminders";

describe("documentReminders", () => {
  const v = (reviewOn: string | null, expiresOn: string | null) => ({
    versionId: "v1",
    reviewOn,
    expiresOn,
  });
  it.each([
    ["no dates", v(null, null), "2026-10-19", []],
    ["review not yet due", v("2026-11-01", null), "2026-10-19", []],
    ["review due today", v("2026-10-19", null), "2026-10-19", ["reviewDue"]],
    ["review overdue", v("2026-09-01", null), "2026-10-19", ["reviewDue"]],
    ["expiry in 31 days", v(null, "2026-11-19"), "2026-10-19", []],
    ["expiry in 30 days", v(null, "2026-11-18"), "2026-10-19", ["expiring"]],
    ["expires today (still in force)", v(null, "2026-10-19"), "2026-10-19", ["expiring"]],
    ["expired yesterday", v(null, "2026-10-18"), "2026-10-19", ["expired"]],
    [
      "review due and expiring",
      v("2026-10-01", "2026-10-30"),
      "2026-10-19",
      ["reviewDue", "expiring"],
    ],
    ["expired drops the rest", v("2026-09-01", "2026-10-01"), "2026-10-19", ["expired"]],
  ] as const)("%s", (_name, version, today, kinds) => {
    expect(documentReminders(version, today).map((r) => r.kind)).toEqual(kinds);
  });

  it("keys each reminder to the version, so a re-run sends nothing new", () => {
    expect(documentReminders(v("2026-10-01", "2026-10-30"), "2026-10-19")).toEqual([
      { kind: "reviewDue", dedupeKey: "document:v1:reviewDue" },
      { kind: "expiring", dedupeKey: "document:v1:expiring" },
    ]);
    expect(documentReminders(v("2026-10-01", "2026-10-30"), "2026-10-20")).toEqual(
      documentReminders(v("2026-10-01", "2026-10-30"), "2026-10-19"),
    );
  });
});
