import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

export type SnapshotRow = {
  facilityId: string;
  frameworkId: string;
  day: Date;
  series: "internal" | "consultant";
  status: "not_ready" | "at_risk" | "ready";
  score: number | null;
  counted: number;
  scored: number;
  esrNotMet: number;
  esrUnverified: number;
  elementsExpired: number;
  overdueCapa: number;
  chapters: Prisma.InputJsonValue;
  departments: Prisma.InputJsonValue;
  createdAt: Date;
};

/** Writes the day's snapshots; a row already recorded for that day is kept as it was. */
export async function insertSnapshots(tx: Tx, tenantId: string, rows: readonly SnapshotRow[]) {
  if (rows.length === 0) return 0;
  const { count } = await tx.complianceSnapshot.createMany({
    data: rows.map((row) => ({ tenantId, ...row })),
    skipDuplicates: true,
  });
  return count;
}

export function listSnapshots(tx: Tx, tenantId: string, facilityId: string, from: Date) {
  return tx.complianceSnapshot.findMany({
    where: { tenantId, facilityId, day: { gte: from } },
    orderBy: [{ day: "asc" }, { series: "asc" }],
    select: { frameworkId: true, day: true, series: true, score: true, status: true },
  });
}
