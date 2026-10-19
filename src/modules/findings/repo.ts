import type { Tx } from "@/lib/db";
import type { FindingSeverity, FindingStatus } from "./domain/severity";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

export type NewFinding = {
  id: string;
  facilityId: string;
  assessmentId: string;
  elementScoreId: string;
  elementId: string;
  departmentId: string | null;
  levelCode: string;
  severity: FindingSeverity;
  statement: string | null;
};

export function insertFindings(tx: Tx, tenantId: string, rows: NewFinding[]) {
  return tx.finding.createMany({ data: rows.map((row) => ({ tenantId, ...row })) });
}

export function listFindings(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  filter: { assessmentId?: string; status?: FindingStatus },
) {
  return tx.finding.findMany({
    where: { tenantId, facilityId, ...filter },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      assessmentId: true,
      departmentId: true,
      levelCode: true,
      severity: true,
      status: true,
      statement: true,
      createdAt: true,
      element: {
        select: { id: true, code: true, titleAr: true, titleEn: true, isEsr: true, sort: true },
      },
    },
  });
}
