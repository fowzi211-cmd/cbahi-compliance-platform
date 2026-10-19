import { withSystem } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service";
import { listUserMemberships } from "@/modules/tenancy/service";
import {
  afterSignInAttempt,
  isLocked,
  isPastAbsoluteLimit,
  requiresMfa,
  type LockoutState,
} from "./domain/rules";
import * as repo from "./repo";

export { sessionPolicy } from "./domain/rules";

export type UserProfile = NonNullable<Awaited<ReturnType<typeof repo.findUserProfile>>>;

export function getUserProfile(userId: string) {
  return repo.findUserProfile(userId);
}

/**
 * Audits an identity event in every tenant the user belongs to, so each organization's log
 * shows who signed in to it and when accounts were locked. Users are global, so this is a
 * cross-tenant write through the system connection.
 */
async function auditInUserTenants(
  userId: string,
  event: { action: "login" | "lock"; ip: string | null; after?: unknown },
) {
  const tenantIds = [...new Set((await listUserMemberships(userId)).map((m) => m.tenantId))];
  if (tenantIds.length === 0) return;
  await withSystem(async (tx) => {
    for (const tenantId of tenantIds) {
      await recordAudit(
        tx,
        { tenantId, userId },
        {
          action: event.action,
          entity: "user",
          entityId: userId,
          ip: event.ip,
          after: event.after,
        },
      );
    }
  });
}

/** True while the account behind this email is locked after repeated wrong passwords. */
export async function isSignInLocked(email: string, now = new Date()) {
  const user = await repo.findLockoutByEmail(email);
  return user ? isLocked(user, now) : false;
}

export async function recordPasswordAttempt(
  email: string,
  outcome: "success" | "failure",
  ip: string | null,
  now = new Date(),
) {
  const user = await repo.findLockoutByEmail(email);
  if (!user) return;
  const before: LockoutState = {
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
  };
  const after = afterSignInAttempt(before, outcome, now);
  if (after === before) return;
  await repo.saveLockout(user.id, after);
  if (!isLocked(before, now) && isLocked(after, now)) {
    await auditInUserTenants(user.id, {
      action: "lock",
      ip,
      after: { lockedUntil: after.lockedUntil },
    });
  }
}

export function recordSignIn(userId: string, ip: string | null) {
  return auditInUserTenants(userId, { action: "login", ip });
}

/** Whether this user must have a second factor before using the app. */
export async function mfaRequired(profile: UserProfile) {
  const memberships = await listUserMemberships(profile.id);
  return requiresMfa({
    isPlatformAdmin: profile.isPlatformAdmin,
    isPlatformConsultant: profile.isPlatformConsultant,
    roles: memberships.map((m) => m.role),
  });
}

/** Ends a session that has reached the 12-hour absolute limit. Returns true when it did. */
export async function enforceAbsoluteSessionLimit(
  session: { id: string; createdAt: Date },
  now = new Date(),
) {
  if (!isPastAbsoluteLimit(session.createdAt, now)) return false;
  await repo.deleteSession(session.id);
  return true;
}

export function markEmailVerified(userId: string) {
  return repo.markEmailVerified(userId);
}
