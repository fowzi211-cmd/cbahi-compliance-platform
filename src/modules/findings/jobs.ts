import { withTenant, type TenantContext } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { notify, type NoticeInput } from "@/modules/notifications/service";
import { listRoleHolders, type MembershipRole } from "@/modules/tenancy/service";
import { escalationNotices, type EscalationTarget } from "./domain/capa";
import * as repo from "./repo";

const roleOf: Record<Exclude<EscalationTarget, "itemOwner">, MembershipRole> = {
  qualityManager: "quality_manager",
  facilityOwner: "facility_owner",
};

/**
 * Rule 7: tells people about overdue actions, one level at a time (1 day → the owner,
 * 7 days → quality managers, 14 days → facility owners). Safe to run any number of times a
 * day: each notice is sent once per person, level and due date. Returns how many are new.
 */
export async function runCapaEscalation(tenantId: string, now: Date) {
  const ctx: TenantContext = { tenantId, userId: null };
  const today = toRiyadhDay(now);
  return withTenant(ctx, async (tx) => {
    const items = await repo.listOverdueItems(tx, tenantId, new Date(`${today}T00:00:00Z`));
    const holders = new Map<string, string[]>();
    const peopleFor = async (facilityId: string, target: EscalationTarget, owner: string) => {
      if (target === "itemOwner") return [owner];
      const key = `${facilityId}:${target}`;
      if (!holders.has(key)) {
        holders.set(key, await listRoleHolders(tx, ctx, facilityId, [roleOf[target]]));
      }
      return holders.get(key)!;
    };

    const notices: NoticeInput[] = [];
    for (const item of items) {
      const dueOn = item.dueOn.toISOString().slice(0, 10);
      for (const notice of escalationNotices({ id: item.id, status: item.status, dueOn }, today)) {
        for (const userId of await peopleFor(item.facilityId, notice.notify, item.ownerUserId)) {
          notices.push({
            facilityId: item.facilityId,
            userId,
            type: "capaOverdue",
            payload: {
              findingId: item.findingId,
              itemId: item.id,
              elementCode: item.finding.element.code,
              action: item.action,
              dueOn,
              level: notice.level,
            },
            dedupeKey: notice.dedupeKey,
          });
        }
      }
    }
    return notify(tx, ctx, notices);
  });
}
