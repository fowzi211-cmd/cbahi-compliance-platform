import { z } from "zod";
import { withSystem, withTenant, type TenantContext, type Tx } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit, recordPlatformAudit } from "@/modules/audit/service";
import { allowed, getFacility, type AccessContext } from "@/modules/tenancy/service";
import {
  featureEnabled,
  features,
  parseOverrides,
  subscriptionProblem,
  effectiveTier,
  tiers,
  type Feature,
  type FeatureOverrides,
  type SubscriptionTerms,
} from "./domain/features";
import {
  closedStatuses,
  facilityTransition,
  platformTransition,
  requestKinds,
  requestLimits,
  type FacilityRequestAction,
  type PlatformRequestAction,
  type RequestStatus,
} from "./domain/requests";
import * as repo from "./repo";

export { features, tiers, tierMatrix } from "./domain/features";
export type { Feature, Tier } from "./domain/features";
export {
  facilityRequestActions,
  platformRequestActions,
  requestKinds,
  requestLimits,
  requestStatuses,
} from "./domain/requests";
export type { RequestKind, RequestStatus } from "./domain/requests";
export type { StruggleReason } from "./domain/struggle";
export { struggleReasons } from "./domain/struggle";

export type SubscriptionError =
  | "notFound"
  | "endsBeforeStart"
  | "notConsultant"
  | "noAccount"
  | "featureOff"
  | "alreadyAssigned"
  | "notAllowed"
  | "kindRequired";

export type PlatformActor = { userId: string; isPlatformAdmin: boolean };

// The platform admin manages tiers, consultants and the request queue. They act for no
// tenant and have no default access to tenant data (§6): these screens read only the
// subscription, facility names and the requests the tenant sent to the platform.
function requireAdmin(actor: PlatformActor) {
  if (!actor.isPlatformAdmin) throw new ForbiddenError("platform.manage");
}

const toDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

function termsOf(row: {
  tier: SubscriptionTerms["tier"];
  startsOn: Date;
  endsOn: Date | null;
  featureOverrides: unknown;
}): SubscriptionTerms {
  return {
    tier: row.tier,
    startsOn: toDay(row.startsOn)!,
    endsOn: toDay(row.endsOn),
    featureOverrides: parseOverrides(row.featureOverrides),
  };
}

function describe(terms: SubscriptionTerms, today: string) {
  return {
    ...terms,
    effectiveTier: effectiveTier(terms, today),
    enabled: features.filter((f) => featureEnabled(terms, f, today)),
  };
}

// --- Feature gates ------------------------------------------------------------------------

/** Whether a feature is on for the tenant today, inside the caller's transaction. */
export async function featureEnabledIn(tx: Tx, ctx: TenantContext, feature: Feature, now: Date) {
  const row = await repo.findSubscription(tx, ctx.tenantId);
  return row ? featureEnabled(termsOf(row), feature, toRiyadhDay(now)) : false;
}

/** Whether a feature is on for the caller's tenant today (rule 10). */
export function isFeatureEnabled(ctx: AccessContext, feature: Feature, now = new Date()) {
  return withTenant(ctx, (tx) => featureEnabledIn(tx, ctx, feature, now));
}

// --- Tenant side --------------------------------------------------------------------------

/**
 * The facility's subscription and who outside the staff can read its data. Owner only
 * (`subscription.view`): the consultants list lets them check access at any time.
 */
export async function getSubscriptionOverview(
  ctx: AccessContext,
  facilityId: string,
  now = new Date(),
) {
  if (!allowed(ctx, "subscription.view", { facilityId })) return null;
  return withTenant(ctx, async (tx) => {
    const row = await repo.findSubscription(tx, ctx.tenantId);
    if (!row) return null;
    const consultants = await repo.listLiveAssignments(tx, ctx.tenantId, facilityId);
    return {
      ...describe(termsOf(row), toRiyadhDay(now)),
      consultants: consultants.map((c) => ({
        name: c.user.name,
        email: c.user.email,
        since: c.createdAt,
      })),
    };
  });
}

export async function listServiceRequests(ctx: AccessContext, facilityId: string) {
  if (!allowed(ctx, "service.request", { facilityId })) return null;
  return withTenant(ctx, (tx) => repo.listRequests(tx, ctx.tenantId, facilityId));
}
export type ServiceRequestRow = NonNullable<
  Awaited<ReturnType<typeof listServiceRequests>>
>[number];

/** The struggle-signal offer waiting for the facility's answer, for the dashboard. */
export async function getOpenOffer(ctx: AccessContext, facilityId: string) {
  if (!allowed(ctx, "service.request", { facilityId })) return null;
  const latest = await withTenant(ctx, (tx) => repo.findLatestOffer(tx, ctx.tenantId, facilityId));
  return latest?.status === "offered" ? latest : null;
}

const note = z
  .string()
  .trim()
  .max(requestLimits.note)
  .transform((v) => (v === "" ? null : v));

const newRequestInput = z.object({ kind: z.enum(requestKinds), note });
export type NewRequestInput = z.input<typeof newRequestInput>;

/** A request from the facility to the platform team. */
export async function createServiceRequest(
  ctx: AccessContext,
  facilityId: string,
  input: NewRequestInput,
  now = new Date(),
) {
  if (!allowed(ctx, "service.request", { facilityId })) {
    throw new ForbiddenError("service.request");
  }
  const data = newRequestInput.parse(input);
  if (!(await getFacility(ctx, facilityId))) throw new DomainError<SubscriptionError>("notFound");
  return withTenant(ctx, async (tx) => {
    const row = await repo.insertRequest(tx, {
      tenantId: ctx.tenantId,
      facilityId,
      kind: data.kind,
      status: "open",
      origin: "user",
      note: data.note,
      requestedBy: ctx.userId,
      submittedAt: now,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "service_request",
      entityId: row.id,
      after: { kind: data.kind, status: "open", origin: "user" },
    });
    return row.id;
  });
}

const answerInput = z.object({
  kind: z.enum(requestKinds).optional(),
  note: note.optional(),
});

/** The facility accepts or dismisses an offer, or withdraws a request not yet started. */
export async function actOnServiceRequest(
  ctx: AccessContext,
  requestId: string,
  action: FacilityRequestAction,
  input: z.input<typeof answerInput> = {},
  now = new Date(),
) {
  const data = answerInput.parse(input);
  if (!z.uuid().safeParse(requestId).success) throw new DomainError<SubscriptionError>("notFound");
  return withTenant(ctx, async (tx) => {
    const row = await repo.findRequest(tx, ctx.tenantId, requestId);
    if (!row || !allowed(ctx, "service.request", { facilityId: row.facilityId })) {
      throw new DomainError<SubscriptionError>("notFound");
    }
    const next = facilityTransition(row.status, action);
    if (!next) throw new DomainError<SubscriptionError>("notAllowed");
    const kind = action === "accept" ? data.kind : undefined;
    if (action === "accept" && !kind) throw new DomainError<SubscriptionError>("kindRequired");
    const moved = await repo.moveRequest(tx, ctx.tenantId, requestId, row.status, {
      status: next,
      ...(kind ? { kind } : {}),
      ...(action === "accept"
        ? { requestedBy: ctx.userId!, submittedAt: now, note: data.note ?? null }
        : {}),
      closedAt: closedStatuses.includes(next) ? now : null,
    });
    if (moved.count === 0) throw new DomainError<SubscriptionError>("notAllowed");
    await recordAudit(tx, ctx, {
      action: "update",
      entity: "service_request",
      entityId: requestId,
      before: { status: row.status },
      after: { status: next, ...(kind ? { kind } : {}) },
    });
  });
}

// --- Platform side ------------------------------------------------------------------------

export const tenantListLimit = 50;

export async function listTenants(actor: PlatformActor, query = "", now = new Date()) {
  requireAdmin(actor);
  const today = toRiyadhDay(now);
  const rows = await withSystem((tx) =>
    repo.listTenants(tx, query.trim().slice(0, 100), tenantListLimit),
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    facilities: t._count.facilities,
    subscription: t.subscription ? describe(termsOf(t.subscription), today) : null,
  }));
}

export async function getTenantForPlatform(
  actor: PlatformActor,
  tenantId: string,
  now = new Date(),
) {
  requireAdmin(actor);
  if (!z.uuid().safeParse(tenantId).success) return null;
  return withSystem(async (tx) => {
    const tenant = await repo.findTenant(tx, tenantId);
    if (!tenant?.subscription) return null;
    const assignments = await repo.listLiveAssignments(tx, tenantId);
    return {
      id: tenant.id,
      name: tenant.name,
      subscription: describe(termsOf(tenant.subscription), toRiyadhDay(now)),
      facilities: tenant.facilities.map((f) => ({
        ...f,
        consultants: assignments
          .filter((a) => a.facilityId === f.id)
          .map((a) => ({
            assignmentId: a.id,
            userId: a.userId,
            name: a.user.name,
            email: a.user.email,
            since: a.createdAt,
          })),
      })),
    };
  });
}
export type PlatformTenant = NonNullable<Awaited<ReturnType<typeof getTenantForPlatform>>>;

const day = z.iso.date();
const subscriptionInput = z.object({
  tier: z.enum(tiers),
  startsOn: day,
  endsOn: z.union([day, z.literal("").transform(() => null), z.null()]),
  // Per feature: follow the tier, or force on or off.
  overrides: z.partialRecord(z.enum(features), z.enum(["tier", "on", "off"])).default({}),
});
export type SubscriptionInput = z.input<typeof subscriptionInput>;

/** The platform admin sets a tenant's tier, term and feature overrides (decision 8). */
export async function updateSubscription(
  actor: PlatformActor,
  tenantId: string,
  input: SubscriptionInput,
) {
  requireAdmin(actor);
  const data = subscriptionInput.parse(input);
  const problem = subscriptionProblem(data);
  if (problem) throw new DomainError<SubscriptionError>(problem);
  const featureOverrides: FeatureOverrides = {};
  for (const feature of features) {
    const choice = data.overrides[feature];
    if (choice === "on") featureOverrides[feature] = true;
    if (choice === "off") featureOverrides[feature] = false;
  }
  await withSystem(async (tx) => {
    const before = await repo.findSubscription(tx, tenantId);
    if (!before) throw new DomainError<SubscriptionError>("notFound");
    const after = {
      tier: data.tier,
      startsOn: data.startsOn,
      endsOn: data.endsOn,
      featureOverrides,
    };
    await repo.updateSubscription(tx, tenantId, after);
    // In the tenant's own chain, so the owner can see when and by whom their plan changed.
    await recordAudit(
      tx,
      { tenantId, userId: actor.userId },
      {
        action: "update",
        entity: "subscription",
        entityId: before.id,
        before: termsOf(before),
        after,
      },
    );
  });
}

export async function listConsultantAccounts(actor: PlatformActor) {
  requireAdmin(actor);
  const rows = await withSystem((tx) => repo.listConsultants(tx));
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    twoFactorEnabled: u.twoFactorEnabled,
    assignments: u.consultantAssignments.map((a) => ({
      id: a.id,
      tenantId: a.tenantId,
      tenantName: a.tenant.name,
      facilityNameAr: a.facility.nameAr,
      facilityNameEn: a.facility.nameEn,
    })),
  }));
}

/**
 * Gives an existing account the consultant flag, or takes it away. Taking it away also ends
 * every live assignment, so no facility is left listing someone who can no longer help.
 */
export async function setConsultant(
  actor: PlatformActor,
  email: string,
  grant: boolean,
  now = new Date(),
) {
  requireAdmin(actor);
  const address = z.email().parse(email.trim().toLowerCase());
  await withSystem(async (tx) => {
    const user = await repo.findUserByEmail(tx, address);
    if (!user) throw new DomainError<SubscriptionError>("noAccount");
    if (user.isPlatformConsultant === grant) return;
    await repo.setConsultantFlag(tx, user.id, grant);
    await recordPlatformAudit(tx, actor.userId, {
      action: grant ? "create" : "revoke",
      entity: "platform_consultant",
      entityId: user.id,
      after: { isPlatformConsultant: grant },
    });
    if (grant) return;
    for (const a of await repo.listLiveAssignmentsOfUser(tx, user.id)) {
      await repo.endAssignment(tx, a.tenantId, a.id, actor.userId, now);
      await recordAudit(
        tx,
        { tenantId: a.tenantId, userId: actor.userId },
        { action: "revoke", entity: "consultant_assignment", entityId: a.id },
      );
    }
  });
}

/** Gives a consultant access to one facility of a tenant whose tier allows it (rule 10). */
export async function assignConsultant(
  actor: PlatformActor,
  tenantId: string,
  facilityId: string,
  userId: string,
  now = new Date(),
) {
  requireAdmin(actor);
  const ids = z.object({ tenantId: z.uuid(), facilityId: z.uuid(), userId: z.uuid() });
  ids.parse({ tenantId, facilityId, userId });
  return withSystem(async (tx) => {
    const tenant = await repo.findTenant(tx, tenantId);
    if (!tenant?.subscription || !tenant.facilities.some((f) => f.id === facilityId)) {
      throw new DomainError<SubscriptionError>("notFound");
    }
    const terms = termsOf(tenant.subscription);
    if (!featureEnabled(terms, "consultantAssignment", toRiyadhDay(now))) {
      throw new DomainError<SubscriptionError>("featureOff");
    }
    const user = await repo.findUser(tx, userId);
    if (!user?.isPlatformConsultant) throw new DomainError<SubscriptionError>("notConsultant");
    if (await repo.findLiveAssignment(tx, tenantId, facilityId, userId)) {
      throw new DomainError<SubscriptionError>("alreadyAssigned");
    }
    const row = await repo.insertAssignment(tx, {
      tenantId,
      facilityId,
      userId,
      assignedBy: actor.userId,
    });
    await recordAudit(
      tx,
      { tenantId, userId: actor.userId },
      {
        action: "create",
        entity: "consultant_assignment",
        entityId: row.id,
        after: { facilityId, consultantUserId: userId },
      },
    );
    return row.id;
  });
}

export async function endConsultantAssignment(
  actor: PlatformActor,
  tenantId: string,
  assignmentId: string,
  now = new Date(),
) {
  requireAdmin(actor);
  if (!z.uuid().safeParse(assignmentId).success || !z.uuid().safeParse(tenantId).success) {
    throw new DomainError<SubscriptionError>("notFound");
  }
  await withSystem(async (tx) => {
    const ended = await repo.endAssignment(tx, tenantId, assignmentId, actor.userId, now);
    if (ended.count === 0) throw new DomainError<SubscriptionError>("notFound");
    await recordAudit(
      tx,
      { tenantId, userId: actor.userId },
      { action: "revoke", entity: "consultant_assignment", entityId: assignmentId },
    );
  });
}

export const platformRequestLimit = 100;

/** The platform team's queue. Offers the facility has not taken up are not the team's work. */
export async function listRequestsForPlatform(
  actor: PlatformActor,
  scope: "active" | "closed" = "active",
) {
  requireAdmin(actor);
  const statuses: RequestStatus[] =
    scope === "active" ? ["open", "in_progress"] : ["done", "cancelled"];
  return withSystem((tx) => repo.listAllRequests(tx, statuses, platformRequestLimit));
}
export type PlatformRequestRow = Awaited<ReturnType<typeof listRequestsForPlatform>>[number];

export async function actOnRequestAsPlatform(
  actor: PlatformActor,
  requestId: string,
  action: PlatformRequestAction,
  platformNote = "",
  now = new Date(),
) {
  requireAdmin(actor);
  if (!z.uuid().safeParse(requestId).success) throw new DomainError<SubscriptionError>("notFound");
  const text = note.parse(platformNote);
  await withSystem(async (tx) => {
    const row = await repo.findRequestAnyTenant(tx, requestId);
    if (!row) throw new DomainError<SubscriptionError>("notFound");
    const next = platformTransition(row.status, action);
    if (!next) throw new DomainError<SubscriptionError>("notAllowed");
    const moved = await repo.moveRequest(tx, row.tenantId, requestId, row.status, {
      status: next,
      ...(text !== null ? { platformNote: text } : {}),
      closedAt: closedStatuses.includes(next) ? now : null,
    });
    if (moved.count === 0) throw new DomainError<SubscriptionError>("notAllowed");
    await recordAudit(
      tx,
      { tenantId: row.tenantId, userId: actor.userId },
      {
        action: "update",
        entity: "service_request",
        entityId: requestId,
        before: { status: row.status },
        after: { status: next },
      },
    );
  });
}
