import type { Tx } from "@/lib/db";
import type { AccreditationStatus } from "./domain/survey-cycle";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

export function findSurveyCycle(tx: Tx, tenantId: string, facilityId: string) {
  return tx.surveyCycle.findFirst({ where: { tenantId, facilityId } });
}

export function upsertSurveyCycle(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  data: {
    status: AccreditationStatus;
    lastSurveyOn: Date | null;
    nextExpectedOn: Date | null;
    notes: string | null;
    updatedBy: string | null;
  },
) {
  return tx.surveyCycle.upsert({
    where: { tenantId_facilityId: { tenantId, facilityId } },
    create: { tenantId, facilityId, ...data },
    update: data,
  });
}
