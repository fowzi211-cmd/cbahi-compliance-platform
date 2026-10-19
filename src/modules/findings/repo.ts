import type { Tx } from "@/lib/db";
import type { CapaEvidenceKind, CapaStatus } from "./domain/capa";
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

const elementSelect = {
  select: { id: true, code: true, titleAr: true, titleEn: true, isEsr: true, sort: true },
} as const;

export function listFindings(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  filter: { assessmentId?: string; status?: FindingStatus; severity?: FindingSeverity },
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
      element: elementSelect,
      capaItems: { select: { status: true, dueOn: true, ownerUserId: true } },
    },
  });
}

const evidenceSelect = {
  id: true,
  kind: true,
  url: true,
  description: true,
  addedBy: true,
  addedAt: true,
  documentVersion: {
    select: {
      id: true,
      version: true,
      document: { select: { id: true, titleAr: true, titleEn: true } },
    },
  },
} as const;

const itemSelect = {
  id: true,
  findingId: true,
  facilityId: true,
  departmentId: true,
  action: true,
  ownerUserId: true,
  dueOn: true,
  status: true,
  closureNote: true,
  closedAt: true,
  closedBy: true,
  createdBy: true,
  createdAt: true,
} as const;

export function findFinding(tx: Tx, tenantId: string, id: string) {
  return tx.finding.findFirst({
    where: { tenantId, id },
    select: {
      id: true,
      facilityId: true,
      assessmentId: true,
      departmentId: true,
      levelCode: true,
      severity: true,
      status: true,
      statement: true,
      createdAt: true,
      closedAt: true,
      verifiedAt: true,
      verifiedScoreId: true,
      element: elementSelect,
      verifiedScore: { select: { assessmentId: true, scoredAt: true } },
      capaItems: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          ...itemSelect,
          evidence: { orderBy: { addedAt: "asc" }, select: evidenceSelect },
        },
      },
    },
  });
}

/** Serializes changes to a finding's actions, so its derived status is computed once. */
export async function lockFinding(tx: Tx, tenantId: string, id: string) {
  const rows = await tx.$queryRaw<{ status: FindingStatus }[]>`
    SELECT status::text AS status FROM finding WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE`;
  return rows[0]?.status ?? null;
}

export function listItemStatuses(tx: Tx, tenantId: string, findingId: string) {
  return tx.capaItem.findMany({ where: { tenantId, findingId }, select: { status: true } });
}

export function setFindingStatus(
  tx: Tx,
  tenantId: string,
  id: string,
  data: { status: FindingStatus; closedAt: Date | null },
) {
  return tx.finding.updateMany({ where: { tenantId, id, NOT: { status: "verified" } }, data });
}

export function listClosedFindings(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  elementIds: string[],
  departmentId: string | null,
) {
  return tx.finding.findMany({
    where: {
      tenantId,
      facilityId,
      status: "closed",
      elementId: { in: elementIds },
      // A facility-wide assessment proves a fix anywhere; a department's only its own.
      ...(departmentId ? { departmentId } : {}),
    },
    select: { id: true, elementId: true, status: true, closedAt: true },
  });
}

export function markVerified(
  tx: Tx,
  tenantId: string,
  id: string,
  data: { verifiedScoreId: string; verifiedAt: Date },
) {
  return tx.finding.updateMany({
    where: { tenantId, id, status: "closed" },
    data: { status: "verified", ...data },
  });
}

export function insertCapaItem(
  tx: Tx,
  tenantId: string,
  data: {
    id: string;
    facilityId: string;
    findingId: string;
    departmentId: string | null;
    action: string;
    ownerUserId: string;
    dueOn: Date;
    createdBy: string;
  },
) {
  return tx.capaItem.create({ data: { tenantId, ...data }, select: { id: true } });
}

export function findCapaItem(tx: Tx, tenantId: string, id: string) {
  return tx.capaItem.findFirst({
    where: { tenantId, id },
    select: {
      ...itemSelect,
      finding: { select: { status: true } },
      _count: { select: { evidence: true } },
    },
  });
}

/** Moves an item only from the status it was read in, so two people cannot both move it. */
export function updateCapaItem(
  tx: Tx,
  tenantId: string,
  id: string,
  from: CapaStatus,
  data: {
    status?: CapaStatus;
    dueOn?: Date;
    closureNote?: string | null;
    closedAt?: Date | null;
    closedBy?: string | null;
  },
) {
  return tx.capaItem.updateMany({ where: { tenantId, id, status: from }, data });
}

export function listOwnedItems(tx: Tx, tenantId: string, facilityId: string, ownerUserId: string) {
  return tx.capaItem.findMany({
    where: { tenantId, facilityId, ownerUserId, status: { in: ["open", "in_progress"] } },
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    select: {
      ...itemSelect,
      finding: { select: { id: true, severity: true, element: elementSelect } },
    },
  });
}

export function listActiveItems(tx: Tx, tenantId: string, facilityId: string) {
  return tx.capaItem.findMany({
    where: { tenantId, facilityId, status: { in: ["open", "in_progress"] } },
    select: { status: true, dueOn: true, departmentId: true },
  });
}

export function insertEvidence(
  tx: Tx,
  tenantId: string,
  data: {
    id: string;
    capaItemId: string;
    kind: CapaEvidenceKind;
    documentVersionId: string | null;
    url: string | null;
    description: string | null;
    addedBy: string;
  },
) {
  return tx.capaEvidence.create({ data: { tenantId, ...data }, select: { id: true } });
}

export function findEvidence(tx: Tx, tenantId: string, id: string) {
  return tx.capaEvidence.findFirst({
    where: { tenantId, id },
    select: { id: true, kind: true, url: true, documentVersionId: true, capaItemId: true },
  });
}

export function deleteEvidence(tx: Tx, tenantId: string, id: string) {
  return tx.capaEvidence.deleteMany({ where: { tenantId, id } });
}
