import { authDb } from "@/lib/db";
import type { LockoutState } from "./domain/rules";

// Identity tables are global and only reachable through the `mustamir_auth` role.

export function findLockoutByEmail(email: string) {
  return authDb().user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, failedLoginCount: true, lockedUntil: true },
  });
}

export async function saveLockout(userId: string, state: LockoutState) {
  await authDb().user.update({ where: { id: userId }, data: state });
}

export function findUserProfile(userId: string) {
  return authDb().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      emailVerified: true,
      twoFactorEnabled: true,
      isPlatformAdmin: true,
      isPlatformConsultant: true,
    },
  });
}

export async function markEmailVerified(userId: string) {
  await authDb().user.update({ where: { id: userId }, data: { emailVerified: true } });
}

export async function deleteSession(sessionId: string) {
  await authDb().session.deleteMany({ where: { id: sessionId } });
}
