// The notification rules (ARCHITECTURE §8): which events reach people by email at once,
// which wait for the daily digest, and what each one carries. Payloads hold only what a
// template needs (codes, titles, dates): never patient data or document contents.

import { z } from "zod";

export const notificationPriorities = ["immediate", "digest"] as const;
export type NotificationPriority = (typeof notificationPriorities)[number];

const day = z.iso.date();
const documentFields = {
  documentId: z.uuid(),
  version: z.number().int().positive(),
  titleAr: z.string().nullable(),
  titleEn: z.string().nullable(),
};
const capaFields = {
  findingId: z.uuid(),
  itemId: z.uuid(),
  elementCode: z.string(),
  action: z.string(),
  dueOn: day,
};

export const payloadSchemas = {
  capaAssigned: z.object(capaFields),
  capaOverdue: z.object({ ...capaFields, level: z.number().int().min(1).max(3) }),
  documentReviewDue: z.object({ ...documentFields, reviewOn: day }),
  documentExpiring: z.object({ ...documentFields, expiresOn: day }),
  documentExpired: z.object({ ...documentFields, expiresOn: day }),
} as const;

export type NotificationType = keyof typeof payloadSchemas;
export const notificationTypes = Object.keys(payloadSchemas) as NotificationType[];
export type NotificationPayload<T extends NotificationType> = z.infer<(typeof payloadSchemas)[T]>;

/**
 * Something someone must act on soon goes out at once; a heads-up waits for the digest, so
 * people are not flooded. An expired document can no longer be cited, so it is urgent; one
 * due for review is still in force.
 */
export const priorityOf: Record<NotificationType, NotificationPriority> = {
  capaAssigned: "immediate",
  capaOverdue: "immediate",
  documentReviewDue: "digest",
  documentExpiring: "digest",
  documentExpired: "immediate",
};

/** Where the notice leads in the app (a locale-free path). */
export function linkOf(type: NotificationType, payload: Record<string, unknown>): string {
  switch (type) {
    case "capaAssigned":
    case "capaOverdue":
      return `/findings/${String(payload.findingId)}`;
    case "documentReviewDue":
    case "documentExpiring":
    case "documentExpired":
      return `/documents/${String(payload.documentId)}`;
  }
}

export type EmailPreferences = { emailImmediate: boolean; emailDigest: boolean };
export const defaultPreferences: EmailPreferences = { emailImmediate: true, emailDigest: true };

export type EmailPlan = "sendNow" | "holdForDigest" | "skip";

/**
 * What the delivery sweep does with a pending notice. Someone who turned off immediate
 * emails still gets urgent notices in the digest, unless that is off too.
 */
export function emailPlan(
  notice: { priority: NotificationPriority; read: boolean },
  prefs: EmailPreferences,
): EmailPlan {
  if (notice.read) return "skip";
  if (notice.priority === "immediate" && prefs.emailImmediate) return "sendNow";
  return prefs.emailDigest ? "holdForDigest" : "skip";
}

/** What the daily digest does with a notice still pending: send it, or drop it from email. */
export function digestPlan(notice: { read: boolean }, prefs: EmailPreferences): "include" | "skip" {
  return !notice.read && prefs.emailDigest ? "include" : "skip";
}

/** A failed send is retried by later sweeps, then given up on (the notice stays in the app). */
export const maxEmailAttempts = 3;

export function afterFailure(attempts: number): "pending" | "failed" {
  return attempts + 1 >= maxEmailAttempts ? "failed" : "pending";
}
