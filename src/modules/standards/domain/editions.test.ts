import { describe, expect, it } from "vitest";
import {
  activationBlocker,
  deletionBlocker,
  licenseNoteBlocker,
  retirementBlocker,
  type EditionState,
} from "./editions";

const draft = (licenseNote: string | null): EditionState => ({ status: "draft", licenseNote });

describe("edition lifecycle", () => {
  it.each([
    [draft("Licensed by the publisher, agreement 12"), null],
    [draft(null), "licenseRequired"],
    [draft("   "), "licenseRequired"],
    [{ status: "active", licenseNote: "x" } as const, "notDraft"],
    [{ status: "retired", licenseNote: "x" } as const, "notDraft"],
  ])("activation of %j → %s", (edition, expected) => {
    expect(activationBlocker(edition)).toBe(expected);
  });

  it.each([
    ["draft", "notActive"],
    ["active", null],
    ["retired", "notActive"],
  ] as const)("retiring a %s edition → %s", (status, expected) => {
    expect(retirementBlocker({ status, licenseNote: "x" })).toBe(expected);
  });

  it.each([
    ["draft", null],
    ["active", "notDraft"],
    ["retired", "notDraft"],
  ] as const)("deleting a %s edition → %s", (status, expected) => {
    expect(deletionBlocker({ status, licenseNote: "x" })).toBe(expected);
  });

  it.each([
    ["draft", "", null],
    ["draft", "note", null],
    ["active", "corrected note", null],
    ["active", " ", "licenseRequired"],
    ["retired", "note", "notDraft"],
  ] as const)("licence note on a %s edition set to %j → %s", (status, note, expected) => {
    expect(licenseNoteBlocker({ status, licenseNote: "old" }, note)).toBe(expected);
  });
});
