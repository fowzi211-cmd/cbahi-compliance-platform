import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import type { NotificationPriority } from "./domain/notifications";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

export type NewNotification = {
  facilityId: string;
  userId: string;
  type: string;
  payload: Prisma.InputJsonValue;
  priority: NotificationPriority;
  dedupeKey: string;
};

/** Inserts the notices not sent before (same person, same key); returns how many are new. */
export async function insertNotifications(tx: Tx, tenantId: string, rows: NewNotification[]) {
  const { count } = await tx.notification.createMany({
    data: rows.map((row) => ({ tenantId, ...row })),
    skipDuplicates: true,
  });
  return count;
}

const listSelect = {
  id: true,
  facilityId: true,
  type: true,
  payload: true,
  priority: true,
  createdAt: true,
  readAt: true,
} as const;

export function listForUser(tx: Tx, tenantId: string, userId: string, take: number) {
  return tx.notification.findMany({
    where: { tenantId, userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: listSelect,
  });
}

export function countUnread(tx: Tx, tenantId: string, userId: string) {
  return tx.notification.count({ where: { tenantId, userId, readAt: null } });
}

export function findForUser(tx: Tx, tenantId: string, userId: string, id: string) {
  return tx.notification.findFirst({ where: { tenantId, userId, id }, select: listSelect });
}

export function markRead(tx: Tx, tenantId: string, userId: string, id: string, at: Date) {
  return tx.notification.updateMany({
    where: { tenantId, userId, id, readAt: null },
    data: { readAt: at },
  });
}

export function markAllRead(tx: Tx, tenantId: string, userId: string, at: Date) {
  return tx.notification.updateMany({
    where: { tenantId, userId, readAt: null },
    data: { readAt: at },
  });
}

export function findPreference(tx: Tx, tenantId: string, userId: string) {
  return tx.notificationPreference.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
  });
}

export function listPreferences(tx: Tx, tenantId: string, userIds: string[]) {
  return tx.notificationPreference.findMany({ where: { tenantId, userId: { in: userIds } } });
}

export function savePreference(
  tx: Tx,
  tenantId: string,
  userId: string,
  data: { emailImmediate: boolean; emailDigest: boolean; locale: string | null },
) {
  return tx.notificationPreference.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, ...data },
    update: data,
  });
}

/**
 * Claims pending notices for this sweep. SKIP LOCKED lets two workers run side by side
 * without sending the same email twice.
 */
export async function claimPending(
  tx: Tx,
  tenantId: string,
  priority: NotificationPriority | null,
  limit: number,
) {
  const ids = priority
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM notification
        WHERE tenant_id = ${tenantId}::uuid AND email_status = 'pending'
          AND priority = ${priority}::"NotificationPriority"
        ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM notification
        WHERE tenant_id = ${tenantId}::uuid AND email_status = 'pending'
        ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
  if (ids.length === 0) return [];
  return tx.notification.findMany({
    where: { tenantId, id: { in: ids.map((row) => row.id) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { ...listSelect, userId: true, emailAttempts: true },
  });
}

export function markEmailed(tx: Tx, tenantId: string, ids: string[], at: Date) {
  return tx.notification.updateMany({
    where: { tenantId, id: { in: ids } },
    data: { emailStatus: "sent", emailedAt: at },
  });
}

export function markSkipped(tx: Tx, tenantId: string, ids: string[]) {
  return tx.notification.updateMany({
    where: { tenantId, id: { in: ids } },
    data: { emailStatus: "skipped" },
  });
}

export function markFailed(tx: Tx, tenantId: string, ids: string[], status: "pending" | "failed") {
  return tx.notification.updateMany({
    where: { tenantId, id: { in: ids } },
    data: { emailStatus: status, emailAttempts: { increment: 1 } },
  });
}
