import type { Tx } from "@/lib/db";
import type { ServiceRequestKind, ServiceRequestStatus, Tier } from "@/generated/prisma/client";

// The only place the subscriptions module touches Prisma. Functions that take a `tenantId`
// filter by it even where RLS already does (ARCHITECTURE §5, layer 1); the platform-side
// functions run on the system connection and are marked as such.

const day = (value: string) => new Date(`${value}T00:00:00Z`);

// --- Subscription -------------------------------------------------------------------------

export function findSubscription(tx: Tx, tenantId: string) {
  return tx.subscription.findUnique({ where: { tenantId } });
}

/** System connection: the app role cannot write subscriptions. */
export function updateSubscription(
  tx: Tx,
  tenantId: string,
  data: { tier: Tier; startsOn: string; endsOn: string | null; featureOverrides: object },
) {
  return tx.subscription.update({
    where: { tenantId },
    data: {
      tier: data.tier,
      startsOn: day(data.startsOn),
      endsOn: data.endsOn ? day(data.endsOn) : null,
      featureOverrides: data.featureOverrides,
    },
  });
}

/** System connection: tenants by name, for the platform screen. */
export function listTenants(tx: Tx, query: string, limit: number) {
  return tx.tenant.findMany({
    where: query ? { name: { contains: query, mode: "insensitive" } } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      createdAt: true,
      subscription: true,
      _count: { select: { facilities: { where: { archivedAt: null } } } },
    },
  });
}

/** System connection. */
export function findTenant(tx: Tx, tenantId: string) {
  return tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      subscription: true,
      facilities: {
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, nameAr: true, nameEn: true },
      },
    },
  });
}

// --- Consultant assignments ---------------------------------------------------------------

const assignmentSelect = {
  id: true,
  facilityId: true,
  userId: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
} as const;

export function listLiveAssignments(tx: Tx, tenantId: string, facilityId?: string) {
  return tx.consultantAssignment.findMany({
    where: { tenantId, endedAt: null, ...(facilityId ? { facilityId } : {}) },
    orderBy: { createdAt: "asc" },
    select: assignmentSelect,
  });
}

export function findLiveAssignment(tx: Tx, tenantId: string, facilityId: string, userId: string) {
  return tx.consultantAssignment.findFirst({
    where: { tenantId, facilityId, userId, endedAt: null },
  });
}

export function findAssignment(tx: Tx, tenantId: string, id: string) {
  return tx.consultantAssignment.findFirst({ where: { tenantId, id } });
}

/** System connection. */
export function insertAssignment(
  tx: Tx,
  data: { tenantId: string; facilityId: string; userId: string; assignedBy: string },
) {
  return tx.consultantAssignment.create({ data });
}

/** System connection. */
export function endAssignment(tx: Tx, tenantId: string, id: string, by: string, now: Date) {
  return tx.consultantAssignment.updateMany({
    where: { tenantId, id, endedAt: null },
    data: { endedAt: now, endedBy: by },
  });
}

/** System connection: every live assignment of one consultant, across tenants. */
export function listLiveAssignmentsOfUser(tx: Tx, userId: string) {
  return tx.consultantAssignment.findMany({
    where: { userId, endedAt: null },
    select: { id: true, tenantId: true, facilityId: true },
  });
}

/** System connection: accounts that hold the consultant flag. */
export function listConsultants(tx: Tx) {
  return tx.user.findMany({
    where: { isPlatformConsultant: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      twoFactorEnabled: true,
      consultantAssignments: {
        where: { endedAt: null },
        select: {
          id: true,
          tenantId: true,
          facility: { select: { nameAr: true, nameEn: true } },
          tenant: { select: { name: true } },
        },
      },
    },
  });
}

/** System connection. */
export function findUserByEmail(tx: Tx, email: string) {
  return tx.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, isPlatformConsultant: true },
  });
}

/** System connection. */
export function findUser(tx: Tx, id: string) {
  return tx.user.findUnique({ where: { id }, select: { id: true, isPlatformConsultant: true } });
}

/** System connection. */
export function setConsultantFlag(tx: Tx, userId: string, isPlatformConsultant: boolean) {
  return tx.user.update({ where: { id: userId }, data: { isPlatformConsultant } });
}

// --- Service requests ---------------------------------------------------------------------

export function listRequests(tx: Tx, tenantId: string, facilityId: string) {
  return tx.serviceRequest.findMany({
    where: { tenantId, facilityId },
    orderBy: { createdAt: "desc" },
  });
}

export function findRequest(tx: Tx, tenantId: string, id: string) {
  return tx.serviceRequest.findFirst({ where: { tenantId, id } });
}

export function insertRequest(
  tx: Tx,
  data: {
    tenantId: string;
    facilityId: string;
    kind: ServiceRequestKind | null;
    status: ServiceRequestStatus;
    origin: "user" | "struggle_signal";
    signalReasons?: string[];
    note?: string | null;
    requestedBy?: string | null;
    submittedAt?: Date | null;
    createdAt?: Date;
  },
) {
  return tx.serviceRequest.create({ data });
}

/** Moves a request only if it is still in `from`, so two people acting at once cannot both win. */
export function moveRequest(
  tx: Tx,
  tenantId: string,
  id: string,
  from: ServiceRequestStatus,
  data: {
    status: ServiceRequestStatus;
    kind?: ServiceRequestKind;
    note?: string | null;
    platformNote?: string | null;
    requestedBy?: string;
    submittedAt?: Date;
    closedAt?: Date | null;
  },
) {
  return tx.serviceRequest.updateMany({ where: { tenantId, id, status: from }, data });
}

/** The newest offer the struggle signal made to a facility, if any. */
export function findLatestOffer(tx: Tx, tenantId: string, facilityId: string) {
  return tx.serviceRequest.findFirst({
    where: { tenantId, facilityId, origin: "struggle_signal" },
    orderBy: { createdAt: "desc" },
  });
}

/** System connection: requests across tenants for the platform team, newest first. */
export function listAllRequests(tx: Tx, statuses: ServiceRequestStatus[], limit: number) {
  return tx.serviceRequest.findMany({
    where: { status: { in: statuses } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      tenant: { select: { name: true } },
      facility: { select: { nameAr: true, nameEn: true } },
    },
  });
}

/** System connection. */
export function findRequestAnyTenant(tx: Tx, id: string) {
  return tx.serviceRequest.findUnique({ where: { id } });
}
