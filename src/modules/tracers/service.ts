import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import {
  createSampledAssessment,
  getAssessmentSheet,
  listAssessments,
  listTracerCandidates,
} from "@/modules/assessments/service";
import { recordAudit } from "@/modules/audit/service";
import { getScoringContent, listFacilityFrameworks } from "@/modules/standards/service";
import {
  allowed,
  getFacility,
  listDepartments,
  listFacilityPeople,
  type AccessContext,
  type Resource,
} from "@/modules/tenancy/service";
import { drawSample, sampleSizeLimits, weighCandidates } from "./domain/sampling";
import { dueState, nextDueOn, tracerFrequencies } from "./domain/schedule";
import * as repo from "./repo";

export { sampleSizeLimits } from "./domain/sampling";
export { tracerFrequencies } from "./domain/schedule";
export type { TracerDueState, TracerFrequency } from "./domain/schedule";

export type TracerError =
  | "notFound"
  | "nameRequired"
  | "unknownFramework"
  | "unknownDepartment"
  | "unknownChapter"
  | "unknownAssignee"
  | "nothingToSample"
  | "runInProgress";

export const tracerLimits = { name: 120 } as const;

type TemplateRow = NonNullable<Awaited<ReturnType<typeof repo.findTemplate>>>;

const scopeOf = (t: TemplateRow): Resource => ({
  facilityId: t.facilityId,
  departmentId: t.departmentId,
});

const canManage = (ctx: AccessContext, t: TemplateRow) => allowed(ctx, "tracer.manage", scopeOf(t));

/** Whoever manages the scope may walk a tracer, and so may the person it is assigned to. */
const canRun = (ctx: AccessContext, t: TemplateRow) =>
  allowed(ctx, "tracer.run", {
    ...scopeOf(t),
    assigneeUserIds: t.assigneeUserId ? [t.assigneeUserId] : [],
  });

const canSee = (ctx: AccessContext, t: TemplateRow) =>
  canRun(ctx, t) || allowed(ctx, "dashboard.view", scopeOf(t));

// --- Setting up -----------------------------------------------------------------------------

/**
 * What the caller can build a template from: the editions the facility uses with their
 * chapters, the scopes they manage, and the people a tracer can be assigned to. Null when
 * they manage no tracers here.
 */
export async function getTemplateOptions(ctx: AccessContext, facilityId: string) {
  if (!(await getFacility(ctx, facilityId))) return null;
  const wholeFacility = allowed(ctx, "tracer.manage", { facilityId, departmentId: null });
  const departments = (await listDepartments(ctx, facilityId)).filter((d) =>
    allowed(ctx, "tracer.manage", { facilityId, departmentId: d.id }),
  );
  if (!wholeFacility && departments.length === 0) return null;
  const frameworks = [];
  for (const framework of await listFacilityFrameworks(ctx, facilityId)) {
    const content = await getScoringContent(ctx, facilityId, framework.id);
    if (!content) continue;
    frameworks.push({ ...content.framework, chapters: content.chapters });
  }
  const people = (await listFacilityPeople(ctx, facilityId))
    .filter((p) => p.roles.some((role) => role !== "viewer"))
    .map((p) => ({ userId: p.userId, name: p.name }));
  return {
    frameworks,
    wholeFacility,
    departments: departments.map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn })),
    people,
  };
}
export type TemplateOptions = NonNullable<Awaited<ReturnType<typeof getTemplateOptions>>>;

const optionalName = z
  .string()
  .trim()
  .max(tracerLimits.name)
  .nullish()
  .transform((value) => value || null);
const optionalUuid = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((value) => value || null);

const templateInput = z.object({
  nameAr: optionalName,
  nameEn: optionalName,
  frameworkId: z.uuid(),
  departmentId: optionalUuid,
  chapterIds: z.array(z.uuid()).max(100).default([]),
  sampleSize: z.coerce.number().int().min(sampleSizeLimits.min).max(sampleSizeLimits.max),
  frequency: z.enum(tracerFrequencies),
  assigneeUserId: optionalUuid,
});
export type TemplateInput = z.input<typeof templateInput>;

/**
 * A tracer template: where to walk (a department or the whole facility), which chapters to
 * draw from, how many elements each run checks, how often, and who usually walks it.
 */
export async function createTemplate(
  ctx: AccessContext,
  facilityId: string,
  input: TemplateInput,
  now = new Date(),
) {
  const data = templateInput.parse(input);
  if (!data.nameAr && !data.nameEn) throw new DomainError<TracerError>("nameRequired");
  const scope = { facilityId, departmentId: data.departmentId };
  if (!allowed(ctx, "tracer.manage", scope)) throw new ForbiddenError("tracer.manage");
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("tracer.manage");
  if (data.departmentId) {
    const departments = await listDepartments(ctx, facilityId);
    if (!departments.some((d) => d.id === data.departmentId)) {
      throw new DomainError<TracerError>("unknownDepartment");
    }
  }
  const chapterIds = [...new Set(data.chapterIds)];
  const pool = await listTracerCandidates(
    ctx,
    facilityId,
    { frameworkId: data.frameworkId, departmentId: data.departmentId, chapterIds },
    now,
  );
  if (!pool) throw new DomainError<TracerError>("unknownFramework");
  if (chapterIds.some((id) => !pool.chapterIds.includes(id))) {
    throw new DomainError<TracerError>("unknownChapter");
  }
  if (pool.candidates.length === 0) throw new DomainError<TracerError>("nothingToSample");
  if (data.assigneeUserId) {
    const people = await listFacilityPeople(ctx, facilityId);
    const person = people.find((p) => p.userId === data.assigneeUserId);
    if (!person || person.roles.every((role) => role === "viewer")) {
      throw new DomainError<TracerError>("unknownAssignee");
    }
  }

  return withTenant(ctx, async (tx) => {
    const { id } = await repo.insertTemplate(tx, ctx.tenantId, {
      facilityId,
      frameworkId: data.frameworkId,
      departmentId: data.departmentId,
      nameAr: data.nameAr,
      nameEn: data.nameEn,
      sampleSize: data.sampleSize,
      frequency: data.frequency,
      assigneeUserId: data.assigneeUserId,
      createdBy: ctx.userId,
      createdAt: now,
      chapterIds,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "tracer_template",
      entityId: id,
      after: {
        framework: `${pool.framework.code} ${pool.framework.edition}`,
        departmentId: data.departmentId,
        chapters: chapterIds.length,
        pool: pool.candidates.length,
        sampleSize: data.sampleSize,
        frequency: data.frequency,
        assigneeUserId: data.assigneeUserId,
      },
    });
    return id;
  });
}

async function loadTemplate(ctx: AccessContext, templateId: string) {
  if (!z.uuid().safeParse(templateId).success) throw new DomainError<TracerError>("notFound");
  const template = await withTenant(ctx, (tx) => repo.findTemplate(tx, ctx.tenantId, templateId));
  if (!template || template.archivedAt || !canSee(ctx, template)) {
    throw new DomainError<TracerError>("notFound");
  }
  return template;
}

/** Retires a template. Its runs stay on record; no new ones can start. */
export async function archiveTemplate(ctx: AccessContext, templateId: string, now = new Date()) {
  const template = await loadTemplate(ctx, templateId);
  if (!canManage(ctx, template)) throw new ForbiddenError("tracer.manage");
  await withTenant(ctx, async (tx) => {
    await repo.archiveTemplate(tx, ctx.tenantId, template.id, now);
    await recordAudit(tx, ctx, {
      action: "archive",
      entity: "tracer_template",
      entityId: template.id,
      before: { archivedAt: null },
      after: { archivedAt: now.toISOString() },
    });
  });
}

// --- Overview -------------------------------------------------------------------------------

/**
 * The tracers screen: each template the caller can see, when it is due and whether a run is
 * open, and the runs they can read, newest first.
 */
export async function listTracers(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!(await getFacility(ctx, facilityId))) return { templates: [], runs: [] };
  const templates = (
    await withTenant(ctx, (tx) => repo.listTemplates(tx, ctx.tenantId, facilityId))
  ).filter((t) => canSee(ctx, t));
  const [runs, assessments] = await Promise.all([
    withTenant(ctx, (tx) =>
      repo.listRuns(
        tx,
        ctx.tenantId,
        templates.map((t) => t.id),
      ),
    ),
    listAssessments(ctx, facilityId, "tracer"),
  ]);
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const today = toRiyadhDay(now);

  const views = templates.map((template) => {
    const own = runs.filter((r) => r.templateId === template.id);
    const lastRunOn = own[0] ? toRiyadhDay(own[0].createdAt) : null;
    const dueOn = nextDueOn({
      frequency: template.frequency,
      createdOn: toRiyadhDay(template.createdAt),
      lastRunOn,
    });
    const open = own.find((r) => assessmentById.get(r.assessmentId)?.status === "in_progress");
    return {
      id: template.id,
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      framework: template.framework,
      department: template.department,
      chapterCount: template.chapters.length,
      sampleSize: template.sampleSize,
      frequency: template.frequency,
      assigneeUserId: template.assigneeUserId,
      lastRunOn,
      dueOn,
      dueState: dueState(dueOn, template.frequency, today),
      openRunId: open?.assessmentId ?? null,
      canRun: canRun(ctx, template) && template.framework.status === "active",
      canManage: canManage(ctx, template),
    };
  });
  const templateById = new Map(views.map((t) => [t.id, t]));
  const runViews = runs.flatMap((run) => {
    const assessment = assessmentById.get(run.assessmentId);
    const template = templateById.get(run.templateId);
    if (!assessment || !template) return [];
    return [
      {
        id: run.assessmentId,
        template: { id: template.id, nameAr: template.nameAr, nameEn: template.nameEn },
        status: assessment.status,
        startedAt: assessment.startedAt,
        submittedAt: assessment.submittedAt,
        sampleSize: assessment.sampleSize,
        scoredCount: assessment.scoredCount,
        canScore: assessment.canScore,
      },
    ];
  });
  return { templates: views, runs: runViews };
}
export type TracerOverview = Awaited<ReturnType<typeof listTracers>>;
export type TracerTemplateView = TracerOverview["templates"][number];

// --- Runs -----------------------------------------------------------------------------------

/**
 * Starts a run: weighs the template's pool, draws the sample with a fresh seed, and opens a
 * tracer assessment over it, assigned to the template's assignee (or to whoever started it).
 * One run per template is open at a time. `seed` is for tests; production always draws one.
 */
export async function startRun(
  ctx: AccessContext,
  templateId: string,
  now = new Date(),
  seed = randomBytes(16).toString("hex"),
) {
  const template = await loadTemplate(ctx, templateId);
  if (!canRun(ctx, template)) throw new ForbiddenError("tracer.run");
  // A retired edition is history: new runs are drawn from the edition now in force.
  if (template.framework.status !== "active") {
    throw new DomainError<TracerError>("unknownFramework");
  }
  const pool = await listTracerCandidates(
    ctx,
    template.facilityId,
    {
      frameworkId: template.frameworkId,
      departmentId: template.departmentId,
      chapterIds: template.chapters.map((c) => c.chapterId),
    },
    now,
  );
  if (!pool) throw new DomainError<TracerError>("unknownFramework");
  const weighted = weighCandidates(pool.candidates, now, pool.validityDays);
  const sample = drawSample(weighted, template.sampleSize, seed);
  if (sample.length === 0) throw new DomainError<TracerError>("nothingToSample");

  return withTenant(ctx, async (tx) => {
    await repo.lockTemplate(tx, ctx.tenantId, template.id);
    if (await repo.findOpenRun(tx, ctx.tenantId, template.id)) {
      throw new DomainError<TracerError>("runInProgress");
    }
    const assessmentId = await createSampledAssessment(tx, ctx, {
      facilityId: template.facilityId,
      frameworkId: template.frameworkId,
      departmentId: template.departmentId,
      elementIds: sample,
      assignedTo: template.assigneeUserId ?? ctx.userId,
      now,
    });
    await repo.insertRun(tx, ctx.tenantId, {
      assessmentId,
      templateId: template.id,
      seed,
      candidates: weighted,
      sampleSize: sample.length,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "tracer_run",
      entityId: assessmentId,
      after: { templateId: template.id, seed, pool: weighted.length, sample: sample.length },
    });
    return assessmentId;
  });
}

const storedCandidates = z.array(z.object({ elementId: z.uuid(), weight: z.number().min(0) }));

/**
 * One run as the run screen shows it: the assessment sheet (its scope is the sample), the
 * template it came from, and how the sample was drawn. Null when the caller may not read it.
 */
export async function getRun(ctx: AccessContext, runId: string) {
  const sheet = await getAssessmentSheet(ctx, runId);
  if (!sheet || sheet.assessment.kind !== "tracer") return null;
  const run = await withTenant(ctx, (tx) => repo.findRun(tx, ctx.tenantId, sheet.assessment.id));
  if (!run) return null;
  const template = await withTenant(ctx, (tx) =>
    repo.findTemplate(tx, ctx.tenantId, run.templateId),
  );
  if (!template) return null;
  const candidates = storedCandidates.safeParse(run.candidates);
  const drawn = sheet.assessment.sample.map((s) => s.elementId).sort();
  // Anyone can check the draw: the stored weights and seed must give back the same sample.
  const redrawn = candidates.success
    ? drawSample(candidates.data, run.sampleSize, run.seed).sort()
    : [];
  return {
    sheet,
    run: {
      seed: run.seed,
      poolSize: candidates.success ? candidates.data.length : 0,
      sampleSize: run.sampleSize,
      startedAt: run.createdAt,
      reproducible: redrawn.length === drawn.length && redrawn.every((id, i) => id === drawn[i]),
    },
    template: {
      id: template.id,
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      frequency: template.frequency,
      department: template.department,
    },
  };
}
export type TracerRunView = NonNullable<Awaited<ReturnType<typeof getRun>>>;
