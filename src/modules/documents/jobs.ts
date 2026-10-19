import { withTenant, type TenantContext } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { notify, type NoticeInput } from "@/modules/notifications/service";
import { listRoleHolders } from "@/modules/tenancy/service";
import { documentReminders } from "./domain/reminders";
import * as repo from "./repo";

const toDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

const typeOf = {
  reviewDue: "documentReviewDue",
  expiring: "documentExpiring",
  expired: "documentExpired",
} as const;

/**
 * Rule 8: review-due and expiring-soon reminders, and an urgent notice once a version in
 * force has expired. They go to the document's owner and to whoever approves documents in
 * the facility (quality managers and owners), each exactly once. Returns how many are new.
 */
export async function runDocumentReminders(tenantId: string, now: Date) {
  const ctx: TenantContext = { tenantId, userId: null };
  const today = toRiyadhDay(now);
  return withTenant(ctx, async (tx) => {
    const versions = await repo.listDatedApprovedVersions(tx, tenantId);
    const approvers = new Map<string, string[]>();
    const notices: NoticeInput[] = [];
    for (const v of versions) {
      const reviewOn = toDay(v.reviewOn);
      const expiresOn = toDay(v.expiresOn);
      const reminders = documentReminders({ versionId: v.id, reviewOn, expiresOn }, today);
      if (reminders.length === 0) continue;
      const facilityId = v.document.facilityId;
      if (!approvers.has(facilityId)) {
        approvers.set(
          facilityId,
          await listRoleHolders(tx, ctx, facilityId, ["quality_manager", "facility_owner"]),
        );
      }
      const people = new Set(approvers.get(facilityId));
      if (v.document.ownerUserId) people.add(v.document.ownerUserId);
      const base = {
        documentId: v.document.id,
        version: v.version,
        titleAr: v.document.titleAr,
        titleEn: v.document.titleEn,
      };
      for (const reminder of reminders) {
        for (const userId of people) {
          const common = { facilityId, userId, dedupeKey: reminder.dedupeKey };
          notices.push(
            reminder.kind === "reviewDue"
              ? { ...common, type: typeOf.reviewDue, payload: { ...base, reviewOn: reviewOn! } }
              : {
                  ...common,
                  type: typeOf[reminder.kind],
                  payload: { ...base, expiresOn: expiresOn! },
                },
          );
        }
      }
    }
    return notify(tx, ctx, notices);
  });
}
