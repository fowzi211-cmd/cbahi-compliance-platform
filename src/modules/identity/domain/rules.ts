// Authentication rules from docs/ARCHITECTURE.md §6. Pure functions: the clock is passed in.

// Roles that can change who has access, sign off evidence or see every department. A stolen
// password alone must not be enough for them, so they need a second factor.
const privilegedRoles = ["facility_owner", "quality_manager"] as const;

export type MfaSubject = {
  isPlatformAdmin: boolean;
  isPlatformConsultant: boolean;
  roles: readonly string[];
};

export function requiresMfa(subject: MfaSubject): boolean {
  return (
    subject.isPlatformAdmin ||
    subject.isPlatformConsultant ||
    subject.roles.some((role) => (privilegedRoles as readonly string[]).includes(role))
  );
}

export const lockoutPolicy = {
  maxFailedAttempts: 5,
  lockMinutes: 15,
} as const;

export type LockoutState = { failedLoginCount: number; lockedUntil: Date | null };

export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * The state after one sign-in attempt. The fifth consecutive wrong password locks the account
 * for 15 minutes; a correct password resets the count. Attempts during a lock do not extend it,
 * so an attacker cannot keep a real user locked out indefinitely by guessing slowly.
 */
export function afterSignInAttempt(
  state: LockoutState,
  outcome: "success" | "failure",
  now: Date,
  policy: { maxFailedAttempts: number; lockMinutes: number } = lockoutPolicy,
): LockoutState {
  if (outcome === "success") return { failedLoginCount: 0, lockedUntil: null };
  if (isLocked(state, now)) return state;

  // A lock that has run out starts a fresh count.
  const previous = state.lockedUntil ? 0 : state.failedLoginCount;
  const failedLoginCount = previous + 1;
  if (failedLoginCount >= policy.maxFailedAttempts) {
    return {
      failedLoginCount: 0,
      lockedUntil: new Date(now.getTime() + policy.lockMinutes * 60_000),
    };
  }
  return { failedLoginCount, lockedUntil: null };
}

export const sessionPolicy = {
  // Sliding window: a session ends after 30 minutes without activity.
  idleSeconds: 30 * 60,
  // How often activity pushes the idle deadline forward (keeps writes low).
  refreshSeconds: 5 * 60,
  // Hard limit from sign-in, whatever the activity: a shared workstation in a clinic is
  // eventually signed out even if someone keeps using it.
  absoluteHours: 12,
} as const;

export function isPastAbsoluteLimit(
  sessionCreatedAt: Date,
  now: Date,
  absoluteHours: number = sessionPolicy.absoluteHours,
): boolean {
  return now.getTime() - sessionCreatedAt.getTime() >= absoluteHours * 3_600_000;
}
