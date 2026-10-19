import { describe, expect, it } from "vitest";
import { invitationExpiry, invitationStatus, inviteInput, sameEmail } from "./invitations";

const now = new Date("2026-10-19T08:00:00Z");
const later = new Date("2026-10-20T08:00:00Z");
const earlier = new Date("2026-10-18T08:00:00Z");

describe("invitationStatus", () => {
  it.each([
    [{ expiresAt: later, acceptedAt: null, revokedAt: null }, "pending"],
    [{ expiresAt: earlier, acceptedAt: null, revokedAt: null }, "expired"],
    [{ expiresAt: now, acceptedAt: null, revokedAt: null }, "expired"],
    [{ expiresAt: later, acceptedAt: earlier, revokedAt: null }, "accepted"],
    [{ expiresAt: earlier, acceptedAt: earlier, revokedAt: null }, "accepted"],
    [{ expiresAt: later, acceptedAt: null, revokedAt: earlier }, "revoked"],
  ] as const)("%j → %s", (invitation, expected) => {
    expect(invitationStatus(invitation, now)).toBe(expected);
  });
});

it("expires a week after it is sent", () => {
  expect(invitationExpiry(now)).toEqual(new Date("2026-10-26T08:00:00Z"));
});

it("compares emails case-insensitively", () => {
  expect(sameEmail("Nurse@Example.test ", "nurse@example.test")).toBe(true);
  expect(sameEmail("a@example.test", "b@example.test")).toBe(false);
});

describe("inviteInput", () => {
  const base = {
    facilityId: "00000000-0000-7000-8000-0000000000f1",
    email: " Head@Example.TEST",
    role: "staff",
  } as const;

  it("lowercases the email and defaults the locale to Arabic", () => {
    expect(inviteInput.parse(base)).toMatchObject({ email: "head@example.test", locale: "ar" });
  });

  it("requires a department for a department head", () => {
    expect(inviteInput.safeParse({ ...base, role: "department_head" }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(inviteInput.safeParse({ ...base, role: "consultant" }).success).toBe(false);
  });
});
