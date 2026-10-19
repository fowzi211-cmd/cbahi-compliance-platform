import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import type { ApprovalDecision, DocumentType, VersionStatus } from "./domain/lifecycle";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

const versionSelect = {
  id: true,
  documentId: true,
  version: true,
  status: true,
  fileName: true,
  contentType: true,
  bytes: true,
  effectiveOn: true,
  reviewOn: true,
  expiresOn: true,
  changeNote: true,
  phiScan: true,
  phiOverride: true,
  uploadedBy: true,
  uploadedAt: true,
} as const;

const documentSelect = {
  id: true,
  facilityId: true,
  departmentId: true,
  type: true,
  titleAr: true,
  titleEn: true,
  ownerUserId: true,
  createdAt: true,
  retiredAt: true,
  department: { select: { nameAr: true, nameEn: true } },
} as const;

export function listDocuments(tx: Tx, tenantId: string, facilityId: string) {
  return tx.document.findMany({
    where: { tenantId, facilityId },
    orderBy: [{ retiredAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      ...documentSelect,
      versions: { orderBy: { version: "desc" }, select: versionSelect },
      _count: { select: { elements: true } },
    },
  });
}

export function findDocument(tx: Tx, tenantId: string, id: string) {
  return tx.document.findFirst({
    where: { tenantId, id },
    select: {
      ...documentSelect,
      versions: {
        orderBy: { version: "desc" },
        select: {
          ...versionSelect,
          approvals: {
            orderBy: { decidedAt: "asc" },
            select: { approverUserId: true, decision: true, comment: true, decidedAt: true },
          },
        },
      },
      elements: {
        orderBy: { createdAt: "asc" },
        select: {
          element: {
            select: { id: true, code: true, titleAr: true, titleEn: true, isEsr: true },
          },
        },
      },
    },
  });
}

export function insertDocument(
  tx: Tx,
  tenantId: string,
  data: {
    id: string;
    facilityId: string;
    departmentId: string | null;
    type: DocumentType;
    titleAr: string | null;
    titleEn: string | null;
    ownerUserId: string;
  },
) {
  return tx.document.create({ data: { tenantId, ...data }, select: { id: true } });
}

export function retireDocument(tx: Tx, tenantId: string, id: string, now: Date) {
  return tx.document.updateMany({
    where: { tenantId, id, retiredAt: null },
    data: { retiredAt: now },
  });
}

/** Locks the document row so two uploads cannot take the same version number. */
export async function lockDocument(tx: Tx, tenantId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM document WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
}

export function findVersion(tx: Tx, tenantId: string, id: string) {
  return tx.documentVersion.findFirst({
    where: { tenantId, id },
    select: {
      ...versionSelect,
      // Only this lookup returns where the file is: the service turns it into a signed URL.
      storageKey: true,
      sha256: true,
      document: { select: documentSelect },
    },
  });
}

export function listVersionHashes(tx: Tx, tenantId: string, documentId: string) {
  return tx.documentVersion.findMany({
    where: { tenantId, documentId },
    select: { version: true, status: true, sha256: true },
  });
}

export function insertVersion(
  tx: Tx,
  tenantId: string,
  data: {
    id: string;
    documentId: string;
    version: number;
    fileName: string;
    contentType: string;
    bytes: number;
    sha256: Uint8Array;
    storageKey: string;
    effectiveOn: Date | null;
    reviewOn: Date | null;
    expiresOn: Date | null;
    changeNote: string | null;
    phiScan: Prisma.InputJsonValue;
    phiOverride: boolean;
    uploadedBy: string;
    uploadedAt: Date;
  },
) {
  return tx.documentVersion.create({
    data: { tenantId, ...data, sha256: Buffer.from(data.sha256), phiAttested: true },
    select: { id: true },
  });
}

export function setVersionStatus(
  tx: Tx,
  tenantId: string,
  id: string,
  from: VersionStatus,
  to: VersionStatus,
) {
  return tx.documentVersion.updateMany({
    where: { tenantId, id, status: from },
    data: { status: to },
  });
}

/** Marks every other approved version of the document as replaced by a newer one. */
export function supersedeOthers(tx: Tx, tenantId: string, documentId: string, keepId: string) {
  return tx.documentVersion.updateMany({
    where: { tenantId, documentId, status: "approved", id: { not: keepId } },
    data: { status: "superseded" },
  });
}

export function insertApproval(
  tx: Tx,
  tenantId: string,
  data: {
    versionId: string;
    approverUserId: string;
    decision: ApprovalDecision;
    comment: string | null;
    decidedAt: Date;
  },
) {
  return tx.documentApproval.create({ data: { tenantId, ...data } });
}

export function linkElement(
  tx: Tx,
  tenantId: string,
  data: { documentId: string; elementId: string; createdBy: string },
) {
  return tx.documentElement.upsert({
    where: { documentId_elementId: { documentId: data.documentId, elementId: data.elementId } },
    create: { tenantId, ...data },
    update: {},
  });
}

export function unlinkElement(tx: Tx, tenantId: string, documentId: string, elementId: string) {
  return tx.documentElement.deleteMany({ where: { tenantId, documentId, elementId } });
}

/** Approved versions of documents still in use, with the elements each document covers. */
export function listApprovedVersions(tx: Tx, tenantId: string, facilityId: string) {
  return tx.documentVersion.findMany({
    where: { tenantId, status: "approved", document: { facilityId, retiredAt: null } },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      version: true,
      status: true,
      reviewOn: true,
      expiresOn: true,
      document: {
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          retiredAt: true,
          elements: { select: { elementId: true } },
        },
      },
    },
  });
}

/** Approved versions with a review or expiry date, in every facility, for the reminder job. */
export function listDatedApprovedVersions(tx: Tx, tenantId: string) {
  return tx.documentVersion.findMany({
    where: {
      tenantId,
      status: "approved",
      document: { retiredAt: null },
      OR: [{ reviewOn: { not: null } }, { expiresOn: { not: null } }],
    },
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      version: true,
      reviewOn: true,
      expiresOn: true,
      document: {
        select: { id: true, facilityId: true, ownerUserId: true, titleAr: true, titleEn: true },
      },
    },
  });
}
