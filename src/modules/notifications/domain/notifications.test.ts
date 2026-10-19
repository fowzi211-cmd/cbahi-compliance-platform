import { describe, expect, it } from "vitest";
import {
  afterFailure,
  digestPlan,
  emailPlan,
  linkOf,
  notificationTypes,
  payloadSchemas,
  priorityOf,
} from "./notifications";

const id = "0190f3c4-0000-7000-8000-000000000001";

describe("priorityOf", () => {
  it.each([
    ["capaAssigned", "immediate"],
    ["capaOverdue", "immediate"],
    ["documentExpired", "immediate"],
    ["documentReviewDue", "digest"],
    ["documentExpiring", "digest"],
  ] as const)("%s → %s", (type, priority) => {
    expect(priorityOf[type]).toBe(priority);
  });

  it("covers every type", () => {
    expect(notificationTypes.every((type) => priorityOf[type])).toBe(true);
  });
});

describe("emailPlan", () => {
  const on = { emailImmediate: true, emailDigest: true };
  it.each([
    ["urgent, all on", "immediate", false, on, "sendNow"],
    [
      "urgent, immediate off",
      "immediate",
      false,
      { ...on, emailImmediate: false },
      "holdForDigest",
    ],
    ["urgent, all off", "immediate", false, { emailImmediate: false, emailDigest: false }, "skip"],
    ["heads-up, digest on", "digest", false, on, "holdForDigest"],
    ["heads-up, digest off", "digest", false, { ...on, emailDigest: false }, "skip"],
    ["already read in the app", "immediate", true, on, "skip"],
  ] as const)("%s", (_name, priority, read, prefs, expected) => {
    expect(emailPlan({ priority, read }, prefs)).toBe(expected);
  });
});

describe("digestPlan", () => {
  it.each([
    [false, true, "include"],
    [true, true, "skip"],
    [false, false, "skip"],
  ] as const)("read %s, digest %s → %s", (read, emailDigest, expected) => {
    expect(digestPlan({ read }, { emailImmediate: true, emailDigest })).toBe(expected);
  });
});

describe("afterFailure", () => {
  it.each([
    [0, "pending"],
    [1, "pending"],
    [2, "failed"],
  ] as const)("after attempt %i → %s", (attempts, expected) => {
    expect(afterFailure(attempts)).toBe(expected);
  });
});

describe("linkOf and payloads", () => {
  it("links CAPA notices to the finding and document notices to the document", () => {
    expect(linkOf("capaOverdue", { findingId: id })).toBe(`/findings/${id}`);
    expect(linkOf("documentExpired", { documentId: id })).toBe(`/documents/${id}`);
  });

  it("rejects a payload that is missing a field", () => {
    expect(
      payloadSchemas.documentExpired.safeParse({ documentId: id, version: 1, titleAr: null })
        .success,
    ).toBe(false);
    expect(
      payloadSchemas.capaOverdue.safeParse({
        findingId: id,
        itemId: id,
        elementCode: "DEMO-X.1.1",
        action: "Retrain",
        dueOn: "2026-10-01",
        level: 2,
      }).success,
    ).toBe(true);
  });
});
