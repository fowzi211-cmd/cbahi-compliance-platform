import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant, type Tx } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/service";
import { findCitableVersion } from "@/modules/documents/service";
import {
  allowed,
  getFacility,
  isFacilityMember,
  listFacilityPeople,
  type AccessContext,
} from "@/modules/tenancy/service";
import {
  capaEvidenceKinds,
  capaEvidenceProblem,
  capaLimits,
  capaTransitions,
  dueDateProblem,
  escalationLevel,
  findingStatusFor,
  isOverdue,
  nextStatus,
  transitionProblem,
  verifiesFinding,
  type CapaStatus,
} from "./domain/capa";
import {
  findingSeverities,
  findingSeverity,
  findingStatuses,
  type FindingSeverity,
  type FindingStatus,
} from "./domain/severity";
import * as repo from "./repo";

export { findingSeverities, findingStatuses } from "./domain/severity";
export type { FindingSeverity, FindingStatus } from "./domain/severity";
export { capaEvidenceKinds, capaLimits, capaStatuses, capaTransitions } from "./domain/capa";
export type { CapaEvidenceKind, CapaStatus, CapaTransition, EscalationLevel } from "./domain/capa";

export type FindingError =
  | "notFound"
  | "findingVerified"
  | "unknownOwner"
  | "dueInPast"
  | "itemClosed"
  | "invalidTransition"
  | "evidenceRequired"
  | "closureNoteRequired"
  | "reasonRequired"
  | "documentRequired"
  | "documentNotCitable"
  | "invalidUrl";

export type FindingSource = {
  facilityId: string;
  assessmentId: string;
  elementScoreId: string;
  elementId: string;
  elementCode: string;
  departmentId: string | null;
  levelCode: string;
  isEsr: boolean;
  // The level as a fraction of full compliance (0..1).
  normalized: number;
  comment: string | null;
};

/**
 * Raises one finding per score, inside the caller's transaction, so a submitted assessment
 * and its findings commit together (rule 6). The caller has already checked permission and
 * picked the scores whose level generates findings.
 */
export async function raiseFindings(tx: Tx, ctx: AccessContext, sources: FindingSource[]) {
  if (sources.length === 0) return [];
  const rows = sources.map((s) => ({
    id: uuidv7(),
    facilityId: s.facilityId,
    assessmentId: s.assessmentId,
    elementScoreId: s.elementScoreId,
    elementId: s.elementId,
    departmentId: s.departmentId,
    levelCode: s.levelCode,
    severity: findingSeverity(s),
    statement: s.comment,
  }));
  await repo.insertFindings(tx, ctx.tenantId, rows);
  for (const [i, row] of rows.entries()) {
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "finding",
      entityId: row.id,
      after: {
        assessmentId: row.assessmentId,
        element: sources[i]!.elementCode,
        levelCode: row.levelCode,
        severity: row.severity,
      },
    });
  }
  return rows.map((r) => r.id);
}

const toDay = (value: Date) => value.toISOString().slice(0, 10);
const fromDay = (value: string) => new Date(`${value}T00:00:00Z`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const scopeOf = (row: { facilityId: string; departmentId: string | null }) => ({
  facilityId: row.facilityId,
  departmentId: row.departmentId,
});

// Planning (assigning, rescheduling, cancelling, reopening) is for those who may create
// actions in the finding's scope. Doing the work is also for the action's owner.
const canPlan = (ctx: AccessContext, row: { facilityId: string; departmentId: string | null }) =>
  allowed(ctx, "capa.create", scopeOf(row));
const canWork = (
  ctx: AccessContext,
  item: { facilityId: string; departmentId: string | null; ownerUserId: string },
) =>
  canPlan(ctx, item) ||
  allowed(ctx, "capa.closeOwn", { ...scopeOf(item), ownerUserId: item.ownerUserId });

// --- Findings -------------------------------------------------------------------------------

const findingFilter = z.object({
  assessmentId: z.uuid().optional().catch(undefined),
  status: z.enum(findingStatuses).optional().catch(undefined),
  severity: z.enum(findingSeverities).optional().catch(undefined),
});

export type Finding = Awaited<ReturnType<typeof listFindings>>[number];

/**
 * A facility's findings the caller may see: everything for those with facility-wide access,
 * only their own department's for a department head or staff member, plus any finding with
 * an action they own. Each carries a summary of its actions as of `now`.
 */
export async function listFindings(
  ctx: AccessContext,
  facilityId: string,
  filter: { assessmentId?: string; status?: FindingStatus; severity?: FindingSeverity } = {},
  now = new Date(),
) {
  if (!(await getFacility(ctx, facilityId))) return [];
  const where = findingFilter.parse(filter);
  const today = toRiyadhDay(now);
  const rows = await withTenant(ctx, (tx) =>
    repo.listFindings(tx, ctx.tenantId, facilityId, where),
  );
  return rows
    .filter(
      (row) =>
        allowed(ctx, "dashboard.view", { facilityId, departmentId: row.departmentId }) ||
        row.capaItems.some((item) => item.ownerUserId === ctx.userId),
    )
    .map(({ capaItems, ...row }) => {
      const items = capaItems.map((item) => ({ status: item.status, dueOn: toDay(item.dueOn) }));
      return {
        ...row,
        capa: {
          total: items.filter((item) => item.status !== "cancelled").length,
          done: items.filter((item) => item.status === "done").length,
          overdue: items.filter((item) => isOverdue(item, today)).length,
        },
      };
    });
}

/** One finding with its actions, as the caller may see and act on it on `now`. */
export async function getFinding(ctx: AccessContext, findingId: string, now = new Date()) {
  if (!z.uuid().safeParse(findingId).success) return null;
  const row = await withTenant(ctx, (tx) => repo.findFinding(tx, ctx.tenantId, findingId));
  if (!row || !isFacilityMember(ctx, row.facilityId)) return null;
  const ownsAny = row.capaItems.some((item) => item.ownerUserId === ctx.userId);
  if (!allowed(ctx, "dashboard.view", scopeOf(row)) && !ownsAny) return null;

  const today = toRiyadhDay(now);
  const people = new Map(
    (await listFacilityPeople(ctx, row.facilityId)).map((p) => [p.userId, p.name]),
  );
  const planner = canPlan(ctx, row) && row.status !== "verified";
  return {
    ...row,
    canPlan: planner,
    capaItems: row.capaItems.map((item) => {
      const dueOn = toDay(item.dueOn);
      const state = { status: item.status, dueOn };
      const worker = canWork(ctx, item);
      return {
        ...item,
        dueOn,
        ownerName: people.get(item.ownerUserId) ?? null,
        overdue: isOverdue(state, today),
        escalation: escalationLevel(state, today),
        allowed: Object.fromEntries(
          capaTransitions.map((t) => [
            t,
            nextStatus(item.status, t) !== null &&
              (t === "start" || t === "complete" ? worker : planner),
          ]),
        ) as Record<(typeof capaTransitions)[number], boolean>,
        canEditEvidence: worker && (item.status === "open" || item.status === "in_progress"),
        canReschedule: planner && (item.status === "open" || item.status === "in_progress"),
      };
    }),
  };
}
export type FindingDetail = NonNullable<Awaited<ReturnType<typeof getFinding>>>;
export type CapaItemView = FindingDetail["capaItems"][number];

/** The caller's own open actions in a facility, soonest due first. */
export async function listMyCapaItems(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!isFacilityMember(ctx, facilityId)) return [];
  const today = toRiyadhDay(now);
  const rows = await withTenant(ctx, (tx) =>
    repo.listOwnedItems(tx, ctx.tenantId, facilityId, ctx.userId),
  );
  return rows.map((item) => {
    const state = { status: item.status, dueOn: toDay(item.dueOn) };
    return {
      ...item,
      dueOn: state.dueOn,
      overdue: isOverdue(state, today),
      escalation: escalationLevel(state, today),
    };
  });
}
export type MyCapaItem = Awaited<ReturnType<typeof listMyCapaItems>>[number];

/**
 * Overdue actions in the facility on `now`, for the readiness rule (more than 5 → at risk).
 * Counted across the whole facility: readiness is a facility-level verdict.
 */
export async function countOverdueCapa(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!allowed(ctx, "dashboard.view", { facilityId })) return 0;
  const today = toRiyadhDay(now);
  const rows = await withTenant(ctx, (tx) => repo.listActiveItems(tx, ctx.tenantId, facilityId));
  return rows.filter((item) => isOverdue({ status: item.status, dueOn: toDay(item.dueOn) }, today))
    .length;
}

/** Who can own an action: any member who can do work (viewers only read). */
export async function listCapaOwners(ctx: AccessContext, facilityId: string) {
  return (await listFacilityPeople(ctx, facilityId))
    .filter((person) => person.roles.some((role) => role !== "viewer"))
    .map((person) => ({ userId: person.userId, name: person.name }));
}

// --- Planning --------------------------------------------------------------------------------

const capaInput = z.object({
  action: z.string().trim().min(1).max(capaLimits.action),
  ownerUserId: z.uuid(),
  dueOn: z.iso.date(),
});

/** Finds a finding for a write, inside the transaction, or fails as not found. */
async function loadFinding(tx: Tx, ctx: AccessContext, findingId: string) {
  if (!z.uuid().safeParse(findingId).success) throw new DomainError<FindingError>("notFound");
  const finding = await repo.findFinding(tx, ctx.tenantId, findingId);
  if (!finding || !isFacilityMember(ctx, finding.facilityId)) {
    throw new DomainError<FindingError>("notFound");
  }
  return finding;
}

/** Re-derives the finding's status from its actions after one of them changed. */
async function syncFindingStatus(
  tx: Tx,
  ctx: AccessContext,
  finding: { id: string; status: FindingStatus },
  now: Date,
) {
  const items = await repo.listItemStatuses(tx, ctx.tenantId, finding.id);
  const status = findingStatusFor(finding.status, items);
  if (status === finding.status) return status;
  await repo.setFindingStatus(tx, ctx.tenantId, finding.id, {
    status,
    closedAt: status === "closed" ? now : null,
  });
  await recordAudit(tx, ctx, {
    action: status === "closed" ? "complete" : "update",
    entity: "finding",
    entityId: finding.id,
    before: { status: finding.status },
    after: { status },
  });
  return status;
}

/** Adds a corrective action to a finding: what will be done, by whom, by when. */
export async function createCapaItem(
  ctx: AccessContext,
  findingId: string,
  input: z.input<typeof capaInput>,
  now = new Date(),
) {
  const data = capaInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const finding = await loadFinding(tx, ctx, findingId);
    if (!canPlan(ctx, finding)) throw new ForbiddenError("capa.create");
    const status = await repo.lockFinding(tx, ctx.tenantId, finding.id);
    if (status === "verified") throw new DomainError<FindingError>("findingVerified");
    if (dueDateProblem(data.dueOn, toRiyadhDay(now))) {
      throw new DomainError<FindingError>("dueInPast");
    }
    const owners = await listCapaOwners(ctx, finding.facilityId);
    if (!owners.some((o) => o.userId === data.ownerUserId)) {
      throw new DomainError<FindingError>("unknownOwner");
    }
    const id = uuidv7();
    await repo.insertCapaItem(tx, ctx.tenantId, {
      id,
      facilityId: finding.facilityId,
      findingId: finding.id,
      departmentId: finding.departmentId,
      action: data.action,
      ownerUserId: data.ownerUserId,
      dueOn: fromDay(data.dueOn),
      createdBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "capa_item",
      entityId: id,
      after: {
        findingId: finding.id,
        element: finding.element.code,
        action: data.action,
        ownerUserId: data.ownerUserId,
        dueOn: data.dueOn,
      },
    });
    await syncFindingStatus(tx, ctx, { id: finding.id, status: status ?? finding.status }, now);
    return { id };
  });
}

async function loadItem(tx: Tx, ctx: AccessContext, itemId: string) {
  if (!z.uuid().safeParse(itemId).success) throw new DomainError<FindingError>("notFound");
  const item = await repo.findCapaItem(tx, ctx.tenantId, itemId);
  if (!item || !isFacilityMember(ctx, item.facilityId)) {
    throw new DomainError<FindingError>("notFound");
  }
  return item;
}

const isActive = (status: CapaStatus) => status === "open" || status === "in_progress";

const rescheduleInput = z.object({
  dueOn: z.iso.date(),
  reason: optionalText(capaLimits.note),
});

/** Moves an action's due date. The reason is kept in the audit log. */
export async function rescheduleCapaItem(
  ctx: AccessContext,
  itemId: string,
  input: z.input<typeof rescheduleInput>,
  now = new Date(),
) {
  const data = rescheduleInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const item = await loadItem(tx, ctx, itemId);
    if (!canPlan(ctx, item)) throw new ForbiddenError("capa.create");
    if (!isActive(item.status)) throw new DomainError<FindingError>("itemClosed");
    if (!data.reason) throw new DomainError<FindingError>("reasonRequired");
    if (dueDateProblem(data.dueOn, toRiyadhDay(now))) {
      throw new DomainError<FindingError>("dueInPast");
    }
    const { count } = await repo.updateCapaItem(tx, ctx.tenantId, item.id, item.status, {
      dueOn: fromDay(data.dueOn),
    });
    if (count === 0) throw new DomainError<FindingError>("invalidTransition");
    await recordAudit(tx, ctx, {
      action: "update",
      entity: "capa_item",
      entityId: item.id,
      before: { dueOn: toDay(item.dueOn) },
      after: { dueOn: data.dueOn, reason: data.reason },
    });
  });
}

const transitionInput = z.object({
  transition: z.enum(capaTransitions),
  note: optionalText(capaLimits.note),
});

/**
 * Moves an action through its lifecycle (rule 7): start, complete (evidence and a closure
 * note required), cancel or reopen (a reason required). The finding's status follows.
 */
export async function transitionCapaItem(
  ctx: AccessContext,
  itemId: string,
  input: z.input<typeof transitionInput>,
  now = new Date(),
) {
  const data = transitionInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const item = await loadItem(tx, ctx, itemId);
    const doingWork = data.transition === "start" || data.transition === "complete";
    if (doingWork ? !canWork(ctx, item) : !canPlan(ctx, item)) {
      throw new ForbiddenError(doingWork ? "capa.closeOwn" : "capa.create");
    }
    const findingStatus = await repo.lockFinding(tx, ctx.tenantId, item.findingId);
    const problem = transitionProblem({
      status: item.status,
      transition: data.transition,
      evidenceCount: item._count.evidence,
      note: data.note,
      findingStatus: findingStatus ?? item.finding.status,
    });
    if (problem) throw new DomainError<FindingError>(problem);
    const to = nextStatus(item.status, data.transition)!;
    const closing = to === "done";
    const { count } = await repo.updateCapaItem(tx, ctx.tenantId, item.id, item.status, {
      status: to,
      closureNote: closing ? data.note : item.closureNote,
      closedAt: closing ? now : null,
      closedBy: closing ? ctx.userId : null,
    });
    if (count === 0) throw new DomainError<FindingError>("invalidTransition");
    await recordAudit(tx, ctx, {
      action: closing ? "complete" : data.transition === "cancel" ? "archive" : "update",
      entity: "capa_item",
      entityId: item.id,
      before: { status: item.status },
      after: {
        status: to,
        note: data.note,
        evidence: item._count.evidence,
        // Recorded so a reviewer can see when a planner closed someone else's action.
        closedByOwner: closing ? item.ownerUserId === ctx.userId : undefined,
      },
    });
    const finding = await syncFindingStatus(
      tx,
      ctx,
      { id: item.findingId, status: findingStatus ?? item.finding.status },
      now,
    );
    return { status: to, findingStatus: finding };
  });
}

// --- Closure evidence -----------------------------------------------------------------------

const evidenceInput = z.object({
  kind: z.enum(capaEvidenceKinds),
  documentVersionId: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((value) => value || null),
  url: optionalText(capaLimits.url),
  description: optionalText(capaLimits.description),
});

/** Attaches proof to an action: an approved document version in force, or a link. */
export async function addCapaEvidence(
  ctx: AccessContext,
  itemId: string,
  input: z.input<typeof evidenceInput>,
  now = new Date(),
) {
  const data = evidenceInput.parse(input);
  const problem = capaEvidenceProblem(data);
  if (problem) throw new DomainError<FindingError>(problem);
  const preview = await withTenant(ctx, (tx) => loadItem(tx, ctx, itemId));
  // Checked outside the transaction: the documents service opens its own.
  const version =
    data.kind === "document"
      ? await findCitableVersion(ctx, preview.facilityId, data.documentVersionId!, now)
      : null;
  if (data.kind === "document" && !version) {
    throw new DomainError<FindingError>("documentNotCitable");
  }
  return withTenant(ctx, async (tx) => {
    const item = await loadItem(tx, ctx, itemId);
    if (!canWork(ctx, item)) throw new ForbiddenError("capa.closeOwn");
    if (!isActive(item.status)) throw new DomainError<FindingError>("itemClosed");
    const id = uuidv7();
    await repo.insertEvidence(tx, ctx.tenantId, {
      id,
      capaItemId: item.id,
      kind: data.kind,
      documentVersionId: version?.versionId ?? null,
      url: data.kind === "link" ? data.url : null,
      description: data.description,
      addedBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "capa_evidence",
      entityId: id,
      after: {
        capaItemId: item.id,
        kind: data.kind,
        documentVersionId: version?.versionId ?? null,
        url: data.kind === "link" ? data.url : null,
      },
    });
    return { id };
  });
}

export async function removeCapaEvidence(ctx: AccessContext, evidenceId: string) {
  if (!z.uuid().safeParse(evidenceId).success) throw new DomainError<FindingError>("notFound");
  return withTenant(ctx, async (tx) => {
    const evidence = await repo.findEvidence(tx, ctx.tenantId, evidenceId);
    if (!evidence) throw new DomainError<FindingError>("notFound");
    const item = await loadItem(tx, ctx, evidence.capaItemId);
    if (!canWork(ctx, item)) throw new ForbiddenError("capa.closeOwn");
    if (!isActive(item.status)) throw new DomainError<FindingError>("itemClosed");
    await repo.deleteEvidence(tx, ctx.tenantId, evidence.id);
    await recordAudit(tx, ctx, {
      action: "delete",
      entity: "capa_evidence",
      entityId: evidence.id,
      before: {
        capaItemId: item.id,
        kind: evidence.kind,
        documentVersionId: evidence.documentVersionId,
        url: evidence.url,
      },
    });
  });
}

// --- Verification ---------------------------------------------------------------------------

export type VerificationScore = {
  elementId: string;
  scoreId: string;
  normalized: number;
  scoredAt: Date;
};

/**
 * Rule 7: closed findings on elements now scored at full compliance, after they closed, are
 * verified. Runs inside the submit transaction of the assessment that holds the scores. A
 * department assessment verifies only its own department's findings.
 */
export async function verifyFindings(
  tx: Tx,
  ctx: AccessContext,
  input: { facilityId: string; departmentId: string | null; scores: VerificationScore[] },
  now: Date,
) {
  const byElement = new Map(input.scores.map((s) => [s.elementId, s]));
  if (byElement.size === 0) return 0;
  const closed = await repo.listClosedFindings(
    tx,
    ctx.tenantId,
    input.facilityId,
    [...byElement.keys()],
    input.departmentId,
  );
  let verified = 0;
  for (const finding of closed) {
    const score = byElement.get(finding.elementId)!;
    if (!verifiesFinding(finding, score)) continue;
    const { count } = await repo.markVerified(tx, ctx.tenantId, finding.id, {
      verifiedScoreId: score.scoreId,
      verifiedAt: now,
    });
    if (count === 0) continue;
    verified += 1;
    await recordAudit(tx, ctx, {
      action: "approve",
      entity: "finding",
      entityId: finding.id,
      before: { status: "closed" },
      after: { status: "verified", scoreId: score.scoreId },
    });
  }
  return verified;
}
