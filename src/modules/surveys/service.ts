import { z } from "zod";
import { withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/service";
import { allowed, getFacility, type AccessContext } from "@/modules/tenancy/service";
import {
  accreditationStatuses,
  surveyCycleProblem,
  type AccreditationStatus,
} from "./domain/survey-cycle";
import * as repo from "./repo";

export { accreditationStatuses, suggestNextSurvey } from "./domain/survey-cycle";
export type { AccreditationStatus, SurveyCycleProblem } from "./domain/survey-cycle";

// Calendar days travel as "YYYY-MM-DD" and are stored in DATE columns, which Prisma maps to
// midnight UTC. Converting at this boundary keeps any time zone from shifting the day.
const toDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const fromDay = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);

export type SurveyCycle = {
  status: AccreditationStatus;
  lastSurveyOn: string | null;
  nextExpectedOn: string | null;
  notes: string | null;
  updatedAt: Date | null;
};

/** The facility's accreditation cycle; a never-surveyed default when none is saved yet. */
export async function getSurveyCycle(
  ctx: AccessContext,
  facilityId: string,
): Promise<SurveyCycle | null> {
  if (!(await getFacility(ctx, facilityId))) return null;
  const row = await withTenant(ctx, (tx) => repo.findSurveyCycle(tx, ctx.tenantId, facilityId));
  if (!row) {
    return {
      status: "never_surveyed",
      lastSurveyOn: null,
      nextExpectedOn: null,
      notes: null,
      updatedAt: null,
    };
  }
  return {
    status: row.status,
    lastSurveyOn: toDay(row.lastSurveyOn),
    nextExpectedOn: toDay(row.nextExpectedOn),
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

const optionalDay = z
  .string()
  .trim()
  .max(10)
  .nullish()
  .transform((value) => value || null);

const surveyCycleInput = z.object({
  status: z.enum(accreditationStatuses),
  lastSurveyOn: optionalDay,
  nextExpectedOn: optionalDay,
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((value) => value || null),
});
export type SurveyCycleInput = z.input<typeof surveyCycleInput>;

/** Saves the facility's accreditation cycle. Dates must tell a consistent story (domain rule). */
export async function saveSurveyCycle(
  ctx: AccessContext,
  facilityId: string,
  input: SurveyCycleInput,
  now = new Date(),
) {
  if (!allowed(ctx, "facility.updateSettings", { facilityId })) {
    throw new ForbiddenError("facility.updateSettings");
  }
  const data = surveyCycleInput.parse(input);
  const problem = surveyCycleProblem(data, toRiyadhDay(now));
  if (problem) throw new DomainError(problem);
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("facility.updateSettings");

  return withTenant(ctx, async (tx) => {
    const before = await repo.findSurveyCycle(tx, ctx.tenantId, facilityId);
    const saved = await repo.upsertSurveyCycle(tx, ctx.tenantId, facilityId, {
      status: data.status,
      lastSurveyOn: fromDay(data.lastSurveyOn),
      nextExpectedOn: fromDay(data.nextExpectedOn),
      notes: data.notes,
      updatedBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: before ? "update" : "create",
      entity: "survey_cycle",
      entityId: saved.id,
      before: before && {
        status: before.status,
        lastSurveyOn: toDay(before.lastSurveyOn),
        nextExpectedOn: toDay(before.nextExpectedOn),
      },
      after: {
        status: data.status,
        lastSurveyOn: data.lastSurveyOn,
        nextExpectedOn: data.nextExpectedOn,
      },
    });
    return saved.id;
  });
}
