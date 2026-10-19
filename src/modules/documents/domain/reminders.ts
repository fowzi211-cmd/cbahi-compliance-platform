// Reminders for approved documents (rule 8, ARCHITECTURE §4): a heads-up when review is due
// or expiry is near, and an urgent notice once a document has expired and can no longer be
// cited. Calendar days are "YYYY-MM-DD" strings in Riyadh time.

/** How many days ahead of expiry people are warned. */
export const expiryWarningDays = 30;

export type DocumentReminderKind = "reviewDue" | "expiring" | "expired";

const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The reminders a version in force calls for on `today`, each with a key that makes it a
 * one-off: a daily job that runs twice, or misses a day, sends each reminder exactly once.
 * An expired version gets only the expiry notice; the others no longer matter.
 */
export function documentReminders(
  version: { versionId: string; reviewOn: string | null; expiresOn: string | null },
  today: string,
): { kind: DocumentReminderKind; dedupeKey: string }[] {
  const key = (kind: DocumentReminderKind) => ({
    kind,
    dedupeKey: `document:${version.versionId}:${kind}`,
  });
  if (version.expiresOn && today > version.expiresOn) return [key("expired")];
  const reminders: { kind: DocumentReminderKind; dedupeKey: string }[] = [];
  if (version.reviewOn && today >= version.reviewOn) reminders.push(key("reviewDue"));
  if (version.expiresOn && daysFrom(today, version.expiresOn) <= expiryWarningDays) {
    reminders.push(key("expiring"));
  }
  return reminders;
}
