import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { withTenant, type TenantContext, type Tx } from "@/lib/db";
import type { AppLocale } from "@/lib/dates";
import type { AccessContext } from "@/modules/tenancy/service";
import {
  defaultPreferences,
  linkOf,
  payloadSchemas,
  priorityOf,
  type NotificationPayload,
  type NotificationType,
} from "./domain/notifications";
import * as repo from "./repo";
import { renderNotification } from "./templates";

export { notificationTypes } from "./domain/notifications";

const isKnownType = (type: string): type is NotificationType => type in payloadSchemas;
export type { NotificationType } from "./domain/notifications";

export type NoticeInput = {
  [T in NotificationType]: {
    facilityId: string;
    userId: string;
    type: T;
    payload: NotificationPayload<T>;
    // Makes the notice a one-off for this person (see the reminder and escalation rules).
    dedupeKey: string;
  };
}[NotificationType];

/**
 * Records notices inside the caller's transaction, so they exist only if the change that
 * caused them commits. Email goes out later from the worker's sweep (the table is the
 * outbox). Returns how many were new.
 */
export async function notify(tx: Tx, ctx: TenantContext, notices: NoticeInput[]) {
  if (notices.length === 0) return 0;
  return repo.insertNotifications(
    tx,
    ctx.tenantId,
    notices.map((notice) => ({
      facilityId: notice.facilityId,
      userId: notice.userId,
      type: notice.type,
      payload: payloadSchemas[notice.type].parse(notice.payload) as Prisma.InputJsonValue,
      priority: priorityOf[notice.type],
      dedupeKey: notice.dedupeKey,
    })),
  );
}

// --- The caller's own inbox -----------------------------------------------------------------

export const inboxSize = 50;

/** The caller's latest notices in this tenant, in their words, newest first. */
export async function listNotifications(ctx: AccessContext, locale: AppLocale) {
  const rows = await withTenant(ctx, (tx) =>
    repo.listForUser(tx, ctx.tenantId, ctx.userId, inboxSize),
  );
  return rows.flatMap((row) => {
    const rendered = renderNotification(locale, row);
    return rendered ? [{ ...row, ...rendered }] : [];
  });
}
export type InboxItem = Awaited<ReturnType<typeof listNotifications>>[number];

export function countUnread(ctx: AccessContext) {
  return withTenant(ctx, (tx) => repo.countUnread(tx, ctx.tenantId, ctx.userId));
}

/**
 * Marks one of the caller's notices read and returns where it leads, or null when it is not
 * theirs. The link comes from the stored notice, never from the request.
 */
export async function openNotification(ctx: AccessContext, id: string, now = new Date()) {
  if (!z.uuid().safeParse(id).success) return null;
  return withTenant(ctx, async (tx) => {
    const row = await repo.findForUser(tx, ctx.tenantId, ctx.userId, id);
    if (!row) return null;
    await repo.markRead(tx, ctx.tenantId, ctx.userId, id, now);
    return isKnownType(row.type)
      ? linkOf(row.type, row.payload as Record<string, unknown>)
      : "/notifications";
  });
}

export async function markAllNotificationsRead(ctx: AccessContext, now = new Date()) {
  await withTenant(ctx, (tx) => repo.markAllRead(tx, ctx.tenantId, ctx.userId, now));
}

// --- Preferences ----------------------------------------------------------------------------

export async function getPreferences(ctx: AccessContext) {
  const row = await withTenant(ctx, (tx) => repo.findPreference(tx, ctx.tenantId, ctx.userId));
  return {
    emailImmediate: row?.emailImmediate ?? defaultPreferences.emailImmediate,
    emailDigest: row?.emailDigest ?? defaultPreferences.emailDigest,
    locale: (row?.locale ?? null) as AppLocale | null,
  };
}
export type NotificationPreferences = Awaited<ReturnType<typeof getPreferences>>;

const preferencesInput = z.object({
  emailImmediate: z.boolean(),
  emailDigest: z.boolean(),
  locale: z
    .enum(["ar", "en", ""])
    .nullish()
    .transform((value) => value || null),
});

/** The caller's own email settings in this tenant. Nobody sets them for someone else. */
export async function savePreferences(ctx: AccessContext, input: z.input<typeof preferencesInput>) {
  const data = preferencesInput.parse(input);
  await withTenant(ctx, (tx) => repo.savePreference(tx, ctx.tenantId, ctx.userId, data));
}
