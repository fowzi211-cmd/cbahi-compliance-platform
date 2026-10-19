import type { Tx } from "@/lib/db";
import type { CommitteeFrequency } from "./domain/schedule";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

const committeeSelect = {
  id: true,
  facilityId: true,
  nameAr: true,
  nameEn: true,
  frequency: true,
  chairUserId: true,
  createdAt: true,
  archivedAt: true,
  elements: {
    orderBy: { element: { code: "asc" } },
    select: {
      element: { select: { id: true, code: true, titleAr: true, titleEn: true, isEsr: true } },
    },
  },
  meetings: {
    orderBy: { heldOn: "desc" },
    select: { id: true, heldOn: true, minutesDocumentId: true, createdAt: true },
  },
} as const;

export function listCommittees(tx: Tx, tenantId: string, facilityId: string) {
  return tx.committee.findMany({
    where: { tenantId, facilityId, archivedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: committeeSelect,
  });
}

export function findCommittee(tx: Tx, tenantId: string, id: string) {
  return tx.committee.findFirst({ where: { tenantId, id }, select: committeeSelect });
}

/** Locks the committee for the rest of the transaction, so two entries cannot race. */
export async function lockCommittee(tx: Tx, tenantId: string, id: string) {
  await tx.$queryRaw`
    SELECT 1 FROM committee WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
}

type CommitteeFields = {
  nameAr: string | null;
  nameEn: string | null;
  frequency: CommitteeFrequency;
  chairUserId: string | null;
};

export function insertCommittee(
  tx: Tx,
  tenantId: string,
  data: CommitteeFields & { facilityId: string; createdBy: string; createdAt: Date },
) {
  return tx.committee.create({ data: { tenantId, ...data }, select: { id: true } });
}

export function updateCommittee(tx: Tx, tenantId: string, id: string, data: CommitteeFields) {
  return tx.committee.updateMany({ where: { tenantId, id, archivedAt: null }, data });
}

export function archiveCommittee(tx: Tx, tenantId: string, id: string, archivedAt: Date) {
  return tx.committee.updateMany({
    where: { tenantId, id, archivedAt: null },
    data: { archivedAt },
  });
}

export function linkElement(
  tx: Tx,
  tenantId: string,
  data: { committeeId: string; elementId: string; createdBy: string },
) {
  return tx.committeeElement.upsert({
    where: {
      committeeId_elementId: { committeeId: data.committeeId, elementId: data.elementId },
    },
    create: { tenantId, ...data },
    update: {},
  });
}

export function unlinkElement(tx: Tx, tenantId: string, committeeId: string, elementId: string) {
  return tx.committeeElement.deleteMany({ where: { tenantId, committeeId, elementId } });
}

// --- Meetings -------------------------------------------------------------------------------

export function findMeeting(tx: Tx, tenantId: string, id: string) {
  return tx.meeting.findFirst({
    where: { tenantId, id },
    select: { id: true, committeeId: true, heldOn: true, minutesDocumentId: true },
  });
}

export function findMeetingOn(tx: Tx, tenantId: string, committeeId: string, heldOn: Date) {
  return tx.meeting.findFirst({
    where: { tenantId, committeeId, heldOn },
    select: { id: true },
  });
}

export function insertMeeting(
  tx: Tx,
  tenantId: string,
  data: { committeeId: string; heldOn: Date; createdBy: string; createdAt: Date },
) {
  return tx.meeting.create({ data: { tenantId, ...data }, select: { id: true } });
}

/** Deletes a meeting entered by mistake. A meeting with minutes stays (the database refuses). */
export function deleteMeeting(tx: Tx, tenantId: string, id: string) {
  return tx.meeting.deleteMany({ where: { tenantId, id, minutesDocumentId: null } });
}

/** Files the minutes, once: a count of 0 means the meeting already has them. */
export function attachMinutes(tx: Tx, tenantId: string, id: string, documentId: string) {
  return tx.meeting.updateMany({
    where: { tenantId, id, minutesDocumentId: null },
    data: { minutesDocumentId: documentId },
  });
}
