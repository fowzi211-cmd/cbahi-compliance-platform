import { describe, expect, it } from "vitest";
import {
  afterSignInAttempt,
  isLocked,
  isPastAbsoluteLimit,
  requiresMfa,
  type LockoutState,
} from "./rules";

const now = new Date("2026-10-19T08:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe("requiresMfa", () => {
  it.each([
    [{ roles: ["facility_owner"] }, true],
    [{ roles: ["quality_manager"] }, true],
    [{ roles: ["staff", "quality_manager"] }, true],
    [{ roles: ["department_head"] }, false],
    [{ roles: ["staff"] }, false],
    [{ roles: ["viewer"] }, false],
    [{ roles: [] }, false],
    [{ roles: [], isPlatformAdmin: true }, true],
    [{ roles: [], isPlatformConsultant: true }, true],
  ])("%j → %s", (subject, expected) => {
    expect(requiresMfa({ isPlatformAdmin: false, isPlatformConsultant: false, ...subject })).toBe(
      expected,
    );
  });
});

describe("afterSignInAttempt", () => {
  const clean: LockoutState = { failedLoginCount: 0, lockedUntil: null };

  it("counts failures below the limit without locking", () => {
    let state = clean;
    for (let i = 1; i <= 4; i++) {
      state = afterSignInAttempt(state, "failure", now);
      expect(state).toEqual({ failedLoginCount: i, lockedUntil: null });
    }
  });

  it("locks for 15 minutes on the fifth failure", () => {
    const state = afterSignInAttempt({ failedLoginCount: 4, lockedUntil: null }, "failure", now);
    expect(state.lockedUntil).toEqual(minutes(15));
    expect(isLocked(state, minutes(14))).toBe(true);
    expect(isLocked(state, minutes(15))).toBe(false);
  });

  it("does not extend a lock with more attempts", () => {
    const locked = { failedLoginCount: 0, lockedUntil: minutes(10) };
    expect(afterSignInAttempt(locked, "failure", minutes(5))).toBe(locked);
  });

  it("starts a fresh count after a lock runs out", () => {
    const expired = { failedLoginCount: 0, lockedUntil: minutes(-1) };
    expect(afterSignInAttempt(expired, "failure", now)).toEqual({
      failedLoginCount: 1,
      lockedUntil: null,
    });
  });

  it("resets on success", () => {
    expect(afterSignInAttempt({ failedLoginCount: 3, lockedUntil: null }, "success", now)).toEqual(
      clean,
    );
  });
});

describe("isPastAbsoluteLimit", () => {
  it.each([
    [0, false],
    [11 * 60 + 59, false],
    [12 * 60, true],
    [13 * 60, true],
  ])("%i minutes after sign-in → %s", (elapsed, expected) => {
    expect(isPastAbsoluteLimit(now, minutes(elapsed))).toBe(expected);
  });
});
