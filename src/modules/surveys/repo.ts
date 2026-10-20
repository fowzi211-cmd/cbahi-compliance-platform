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

// --- Mock survey reports (M15) ----------------------------------------------------------------

export function listReports(tx: Tx, tenantId: string, assessmentId: string) {
  return tx.surveyReport.findMany({
    where: { tenantId, assessmentId },
    orderBy: { locale: "asc" },
    select: {
      locale: true,
      createdAt: true,
      createdBy: true,
      document: {
        select: {
          id: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true, fileName: true, bytes: true },
          },
        },
      },
    },
  });
}

export function insertReport(
  tx: Tx,
  tenantId: string,
  data: { assessmentId: string; locale: string; documentId: string; createdBy: string },
) {
  return tx.surveyReport.create({ data: { tenantId, ...data }, select: { id: true } });
}
