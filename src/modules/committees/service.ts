import { z } from "zod";
import { withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/service";
import { createDocument, listDocuments } from "@/modules/documents/service";
import { getFacilityElement, listFacilityElements } from "@/modules/standards/service";
import {
  allowed,
  getFacility,
  isFacilityMember,
  listFacilityPeople,
  type AccessContext,
} from "@/modules/tenancy/service";
import { committeeFrequencies, meetingDueState, nextMeetingDueOn } from "./domain/schedule";
import * as repo from "./repo";

export { committeeFrequencies } from "./domain/schedule";
export type { CommitteeFrequency, MeetingDueState } from "./domain/schedule";

export type CommitteeError =
  | "notFound"
  | "nameRequired"
  | "unknownChair"
  | "unknownElement"
  | "meetingInFuture"
  | "meetingExists"
  | "minutesExist";

export const committeeLimits = { name: 120 } as const;

// Calendar days travel as "YYYY-MM-DD" and are stored in DATE columns (midnight UTC).
const toDay = (value: Date) => value.toISOString().slice(0, 10);
const fromDay = (value: string) => new Date(`${value}T00:00:00Z`);

type CommitteeRow = NonNullable<Awaited<ReturnType<typeof repo.findCommittee>>>;

// Committees are facility-wide: the quality structure of the facility as a whole.
const canManage = (ctx: AccessContext, facilityId: string) =>
  allowed(ctx, "committee.manage", { facilityId, departmentId: null });

export type MinutesStatus = "missing" | "inReview" | "approved" | "rejected" | "retired";

function scheduleOf(committee: CommitteeRow, today: string) {
  const lastHeldOn = committee.meetings[0] ? toDay(committee.meetings[0].heldOn) : null;
  const dueOn = nextMeetingDueOn({
    frequency: committee.frequency,
    createdOn: toRiyadhDay(committee.createdAt),
    lastHeldOn,
  });
  return { lastHeldOn, dueOn, dueState: meetingDueState(dueOn, today) };
}

async function chairNames(ctx: AccessContext, facilityId: string) {
  const people = await listFacilityPeople(ctx, facilityId);
  return new Map(people.map((p) => [p.userId, p.name]));
}

// --- Reading --------------------------------------------------------------------------------

/**
 * The committees screen: every active committee of the facility with when it last met,
 * when it is due to meet again, and how many of its meetings still lack minutes. Every
 * member of the facility can read it.
 */
export async function listCommittees(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!(await getFacility(ctx, facilityId))) return { committees: [], canManage: false };
  const rows = await withTenant(ctx, (tx) => repo.listCommittees(tx, ctx.tenantId, facilityId));
  const names = await chairNames(ctx, facilityId);
  const today = toRiyadhDay(now);
  return {
    canManage: canManage(ctx, facilityId),
    committees: rows.map((c) => ({
      id: c.id,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      frequency: c.frequency,
      chairName: c.chairUserId ? (names.get(c.chairUserId) ?? null) : null,
      elementCount: c.elements.length,
      meetingCount: c.meetings.length,
      minutesMissing: c.meetings.filter((m) => !m.minutesDocumentId).length,
      ...scheduleOf(c, today),
    })),
  };
}
export type CommitteeSummary = Awaited<ReturnType<typeof listCommittees>>["committees"][number];

async function loadCommittee(ctx: AccessContext, committeeId: string) {
  if (!z.uuid().safeParse(committeeId).success) {
    throw new DomainError<CommitteeError>("notFound");
  }
  const committee = await withTenant(ctx, (tx) =>
    repo.findCommittee(tx, ctx.tenantId, committeeId),
  );
  if (!committee || committee.archivedAt || !isFacilityMember(ctx, committee.facilityId)) {
    throw new DomainError<CommitteeError>("notFound");
  }
  return committee;
}

function minutesStatus(
  document: { retiredAt: Date | null; current: unknown; pendingVersion: number | null } | undefined,
): MinutesStatus {
  if (!document) return "missing";
  if (document.retiredAt) return "retired";
  if (document.current) return "approved";
  return document.pendingVersion !== null ? "inReview" : "rejected";
}

/**
 * One committee: the elements it oversees, its meetings with the state of their minutes,
 * and its schedule. Null when the caller is not a member of its facility.
 */
export async function getCommittee(ctx: AccessContext, committeeId: string, now = new Date()) {
  const committee = await loadCommittee(ctx, committeeId).catch((error: unknown) => {
    if (error instanceof DomainError) return null;
    throw error;
  });
  if (!committee) return null;
  const [names, documents] = await Promise.all([
    chairNames(ctx, committee.facilityId),
    listDocuments(ctx, committee.facilityId, now),
  ]);
  const documentById = new Map(documents.map((d) => [d.id, d]));
  return {
    id: committee.id,
    facilityId: committee.facilityId,
    nameAr: committee.nameAr,
    nameEn: committee.nameEn,
    frequency: committee.frequency,
    chairUserId: committee.chairUserId,
    chairName: committee.chairUserId ? (names.get(committee.chairUserId) ?? null) : null,
    createdAt: committee.createdAt,
    elements: committee.elements.map((e) => e.element),
    meetings: committee.meetings.map((m) => ({
      id: m.id,
      heldOn: toDay(m.heldOn),
      minutesDocumentId: m.minutesDocumentId,
      minutes: minutesStatus(
        m.minutesDocumentId ? documentById.get(m.minutesDocumentId) : undefined,
      ),
    })),
    ...scheduleOf(committee, toRiyadhDay(now)),
    canManage: canManage(ctx, committee.facilityId),
  };
}
export type CommitteeDetail = NonNullable<Awaited<ReturnType<typeof getCommittee>>>;

/** What a manager picks from: the facility's people (for the chair) and its elements. */
export async function getCommitteeOptions(ctx: AccessContext, facilityId: string) {
  if (!canManage(ctx, facilityId) || !(await getFacility(ctx, facilityId))) return null;
  const [people, elements] = await Promise.all([
    listFacilityPeople(ctx, facilityId),
    listFacilityElements(ctx, facilityId),
  ]);
  return { people: people.map((p) => ({ userId: p.userId, name: p.name })), elements };
}
export type CommitteeOptions = NonNullable<Awaited<ReturnType<typeof getCommitteeOptions>>>;

// --- Committees -----------------------------------------------------------------------------

const optionalName = z
  .string()
  .trim()
  .max(committeeLimits.name)
  .nullish()
  .transform((value) => value || null);

const committeeInput = z.object({
  nameAr: optionalName,
  nameEn: optionalName,
  frequency: z.enum(committeeFrequencies),
  chairUserId: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((value) => value || null),
});
export type CommitteeInput = z.input<typeof committeeInput>;

async function parseCommittee(ctx: AccessContext, facilityId: string, input: CommitteeInput) {
  const data = committeeInput.parse(input);
  if (!data.nameAr && !data.nameEn) throw new DomainError<CommitteeError>("nameRequired");
  if (data.chairUserId) {
    const people = await listFacilityPeople(ctx, facilityId);
    if (!people.some((p) => p.userId === data.chairUserId)) {
      throw new DomainError<CommitteeError>("unknownChair");
    }
  }
  return data;
}

/** A committee of the facility: its name, how often it must meet, and who chairs it. */
export async function createCommittee(
  ctx: AccessContext,
  facilityId: string,
  input: CommitteeInput,
  now = new Date(),
) {
  if (!canManage(ctx, facilityId)) throw new ForbiddenError("committee.manage");
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("committee.manage");
  const data = await parseCommittee(ctx, facilityId, input);
  return withTenant(ctx, async (tx) => {
    const { id } = await repo.insertCommittee(tx, ctx.tenantId, {
      facilityId,
      ...data,
      createdBy: ctx.userId,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "committee",
      entityId: id,
      after: data,
    });
    return id;
  });
}

/** Renames a committee, changes how often it meets, or appoints another chair. */
export async function updateCommittee(
  ctx: AccessContext,
  committeeId: string,
  input: CommitteeInput,
) {
  const committee = await loadCommittee(ctx, committeeId);
  if (!canManage(ctx, committee.facilityId)) throw new ForbiddenError("committee.manage");
  const data = await parseCommittee(ctx, committee.facilityId, input);
  await withTenant(ctx, async (tx) => {
    await repo.updateCommittee(tx, ctx.tenantId, committee.id, data);
    await recordAudit(tx, ctx, {
      action: "update",
      entity: "committee",
      entityId: committee.id,
      before: {
        nameAr: committee.nameAr,
        nameEn: committee.nameEn,
        frequency: committee.frequency,
        chairUserId: committee.chairUserId,
      },
      after: data,
    });
  });
}

/** Dissolves a committee. Its meetings and minutes stay on record. */
export async function archiveCommittee(ctx: AccessContext, committeeId: string, now = new Date()) {
  const committee = await loadCommittee(ctx, committeeId);
  if (!canManage(ctx, committee.facilityId)) throw new ForbiddenError("committee.manage");
  await withTenant(ctx, async (tx) => {
    await repo.archiveCommittee(tx, ctx.tenantId, committee.id, now);
    await recordAudit(tx, ctx, {
      action: "archive",
      entity: "committee",
      entityId: committee.id,
      before: { archivedAt: null },
      after: { archivedAt: now.toISOString() },
    });
  });
}

/**
 * Records that the committee oversees an element of an edition the facility uses (or no
 * longer does). Minutes filed from now on are linked to it; minutes already filed keep the
 * links they had, because they record what the committee oversaw when it met.
 */
export async function setCommitteeElement(
  ctx: AccessContext,
  committeeId: string,
  elementId: string,
  linked: boolean,
) {
  const committee = await loadCommittee(ctx, committeeId);
  if (!canManage(ctx, committee.facilityId)) throw new ForbiddenError("committee.manage");
  const element = await getFacilityElement(ctx, committee.facilityId, elementId);
  if (!element) throw new DomainError<CommitteeError>("unknownElement");
  await withTenant(ctx, async (tx) => {
    if (linked) {
      await repo.linkElement(tx, ctx.tenantId, {
        committeeId: committee.id,
        elementId: element.id,
        createdBy: ctx.userId,
      });
    } else if ((await repo.unlinkElement(tx, ctx.tenantId, committee.id, element.id)).count === 0) {
      return;
    }
    await recordAudit(tx, ctx, {
      action: linked ? "link" : "unlink",
      entity: "committee_element",
      entityId: committee.id,
      after: { element: element.code },
    });
  });
}

// --- Meetings -------------------------------------------------------------------------------

const meetingInput = z.object({ heldOn: z.iso.date() });
export type MeetingInput = z.input<typeof meetingInput>;

/**
 * Records a meeting that took place. Not one in the future: a meeting on the record is one
 * that was held, and its minutes follow. One meeting per committee per day.
 */
export async function recordMeeting(
  ctx: AccessContext,
  committeeId: string,
  input: MeetingInput,
  now = new Date(),
) {
  const { heldOn } = meetingInput.parse(input);
  const committee = await loadCommittee(ctx, committeeId);
  if (!canManage(ctx, committee.facilityId)) throw new ForbiddenError("committee.manage");
  if (heldOn > toRiyadhDay(now)) throw new DomainError<CommitteeError>("meetingInFuture");
  return withTenant(ctx, async (tx) => {
    await repo.lockCommittee(tx, ctx.tenantId, committee.id);
    if (await repo.findMeetingOn(tx, ctx.tenantId, committee.id, fromDay(heldOn))) {
      throw new DomainError<CommitteeError>("meetingExists");
    }
    const { id } = await repo.insertMeeting(tx, ctx.tenantId, {
      committeeId: committee.id,
      heldOn: fromDay(heldOn),
      createdBy: ctx.userId,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "meeting",
      entityId: id,
      after: { committeeId: committee.id, heldOn },
    });
    return id;
  });
}

async function loadMeeting(ctx: AccessContext, meetingId: string) {
  if (!z.uuid().safeParse(meetingId).success) throw new DomainError<CommitteeError>("notFound");
  const meeting = await withTenant(ctx, (tx) => repo.findMeeting(tx, ctx.tenantId, meetingId));
  if (!meeting) throw new DomainError<CommitteeError>("notFound");
  const committee = await loadCommittee(ctx, meeting.committeeId);
  if (!canManage(ctx, committee.facilityId)) throw new ForbiddenError("committee.manage");
  return { meeting, committee };
}

/** Removes a meeting entered by mistake. Once minutes are filed it stays on record. */
export async function deleteMeeting(ctx: AccessContext, meetingId: string) {
  const { meeting } = await loadMeeting(ctx, meetingId);
  if (meeting.minutesDocumentId) throw new DomainError<CommitteeError>("minutesExist");
  await withTenant(ctx, async (tx) => {
    if ((await repo.deleteMeeting(tx, ctx.tenantId, meeting.id)).count === 0) {
      throw new DomainError<CommitteeError>("minutesExist");
    }
    await recordAudit(tx, ctx, {
      action: "delete",
      entity: "meeting",
      entityId: meeting.id,
      before: { committeeId: meeting.committeeId, heldOn: toDay(meeting.heldOn) },
    });
  });
}

const minutesInput = z.object({
  titleAr: z.string().nullish(),
  titleEn: z.string().nullish(),
  file: z.object({ name: z.string(), bytes: z.custom<Uint8Array>() }),
  phiAttested: z.boolean(),
  phiConfirmed: z.boolean().default(false),
});
export type MinutesInput = z.input<typeof minutesInput>;

/**
 * Files a meeting's minutes as a facility-wide document of type `minutes`, in force from the
 * meeting day and linked to every element the committee oversees. It goes through document
 * approval like any document; once approved it is evidence a score can cite for those
 * elements (rule 8). The document and the meeting's link to it are written together.
 */
export async function fileMinutes(
  ctx: AccessContext,
  meetingId: string,
  input: MinutesInput,
  now = new Date(),
) {
  const data = minutesInput.parse(input);
  const { meeting, committee } = await loadMeeting(ctx, meetingId);
  if (meeting.minutesDocumentId) throw new DomainError<CommitteeError>("minutesExist");
  const { documentId } = await createDocument(
    ctx,
    committee.facilityId,
    {
      type: "minutes",
      titleAr: data.titleAr,
      titleEn: data.titleEn,
      departmentId: null,
      file: data.file,
      effectiveOn: toDay(meeting.heldOn),
      phiAttested: data.phiAttested,
      phiConfirmed: data.phiConfirmed,
    },
    now,
    {
      elementIds: committee.elements.map((e) => e.element.id),
      inTransaction: async (tx, created) => {
        const { count } = await repo.attachMinutes(
          tx,
          ctx.tenantId,
          meeting.id,
          created.documentId,
        );
        if (count === 0) throw new DomainError<CommitteeError>("minutesExist");
        await recordAudit(tx, ctx, {
          action: "update",
          entity: "meeting",
          entityId: meeting.id,
          before: { minutesDocumentId: null },
          after: { minutesDocumentId: created.documentId },
        });
      },
    },
  );
  return documentId;
}
