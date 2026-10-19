import { z } from "zod";
import { withTenant, type Tx } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/service";
import { findCitableVersion } from "@/modules/documents/service";
import {
  countOverdueCapa,
  listFindings,
  raiseFindings,
  verifyFindings,
} from "@/modules/findings/service";
import {
  getScoringContent,
  listFacilityFrameworks,
  type ScoringContent,
} from "@/modules/standards/service";
import {
  allowed,
  getFacility,
  listDepartments,
  type AccessContext,
  type Action,
  type Resource,
} from "@/modules/tenancy/service";
import {
  evidenceKinds,
  evidenceLimits,
  evidenceProblem,
  inScope,
  progress,
  unscoredElements,
  type AssessmentKind,
} from "./domain/assessment";
import { elementScoreProblems } from "./domain/element-score";
import {
  elementState,
  statusUpdatesOnSubmit,
  type ElementStatusRecord,
} from "./domain/element-status";
import { defaultScoreValidityDays } from "./domain/expiry";
import { defaultReadinessSettings } from "./domain/readiness";
import { computeRollup, rollupSettingsFrom } from "./domain/rollup";
import { findLevel, normalizedValue } from "./domain/scale";
import { evaluateFacility } from "./domain/scoring";
import * as repo from "./repo";

export { evidenceKinds, evidenceLimits } from "./domain/assessment";
export type { AssessmentKind, AssessmentStatus, EvidenceKind } from "./domain/assessment";
export type { ReadinessReason, ReadinessStatus } from "./domain/readiness";

export type AssessmentError =
  | "notFound"
  | "assessmentSubmitted"
  | "unknownFramework"
  | "unknownDepartment"
  | "nothingToScore"
  | "unknownElement"
  | "incomplete"
  | "documentRequired"
  | "documentNotCitable"
  | "invalidUrl"
  | "noteRequired"
  | "unknownLevel"
  | "elementNotApplicable"
  | "esrLevelNotAllowed"
  | "evidenceRequired"
  | "commentRequired";

type AssessmentRow = NonNullable<Awaited<ReturnType<typeof repo.findAssessment>>>;
type Scoped = {
  facilityId: string;
  departmentId: string | null;
  kind: AssessmentKind;
  assignedTo: string | null;
};

const scopeOf = (a: Scoped): Resource => ({
  facilityId: a.facilityId,
  departmentId: a.departmentId,
  assigneeUserIds: a.assignedTo ? [a.assignedTo] : [],
});

/** A tracer run is scored under `tracer.run` (its assignee may score it); the rest by role. */
const scoreAction = (a: Scoped): Action =>
  a.kind === "tracer" ? "tracer.run" : "assessment.score";

const canScore = (ctx: AccessContext, a: Scoped) => allowed(ctx, scoreAction(a), scopeOf(a));

/** Scorers see what they score; anyone with the dashboard for that scope may read it. */
function canRead(ctx: AccessContext, a: Scoped) {
  return canScore(ctx, a) || allowed(ctx, "dashboard.view", scopeOf(a));
}

/**
 * The department type an assessment is scoped to: undefined for a whole-facility
 * assessment, null for a department that has no type (and so nothing to score).
 */
const departmentTypeOf = (a: AssessmentRow) =>
  a.departmentId === null ? undefined : (a.department?.typeCode ?? null);

/** A sampled assessment (a tracer run) covers its drawn elements; the others everything. */
const sampleOf = (a: AssessmentRow) =>
  a.kind === "tracer" ? new Set(a.sample.map((s) => s.elementId)) : undefined;

function scopeElements(
  content: ScoringContent,
  departmentType: string | null | undefined,
  sample?: ReadonlySet<string>,
) {
  return content.elements.filter(
    (e) => inScope(e, departmentType) && (!sample || sample.has(e.id)),
  );
}

const assessmentScope = (content: ScoringContent, a: AssessmentRow) =>
  scopeElements(content, departmentTypeOf(a), sampleOf(a));

async function loadAssessment(ctx: AccessContext, assessmentId: string) {
  if (!z.uuid().safeParse(assessmentId).success) return null;
  const row = await withTenant(ctx, (tx) => repo.findAssessment(tx, ctx.tenantId, assessmentId));
  return row && canRead(ctx, row) ? row : null;
}

/** The assessment, its framework content and the caller's right to score it. */
async function loadForScoring(ctx: AccessContext, assessmentId: string) {
  const assessment = await loadAssessment(ctx, assessmentId);
  if (!assessment) throw new DomainError<AssessmentError>("notFound");
  if (!canScore(ctx, assessment)) throw new ForbiddenError(scoreAction(assessment));
  if (assessment.status !== "in_progress") {
    throw new DomainError<AssessmentError>("assessmentSubmitted");
  }
  const content = await getScoringContent(ctx, assessment.facilityId, assessment.frameworkId);
  if (!content) throw new DomainError<AssessmentError>("unknownFramework");
  return { assessment, content };
}

// --- Listing and starting -------------------------------------------------------------------

export type AssessmentSummary = Awaited<ReturnType<typeof listAssessments>>[number];

/** The facility's assessments of one kind that the caller may read, newest first. */
export async function listAssessments(
  ctx: AccessContext,
  facilityId: string,
  kind: AssessmentKind = "self",
) {
  if (!(await getFacility(ctx, facilityId))) return [];
  const rows = await withTenant(ctx, (tx) =>
    repo.listAssessments(tx, ctx.tenantId, facilityId, kind),
  );
  return rows
    .filter((row) => canRead(ctx, row))
    .map(({ _count, sample, ...row }) => ({
      ...row,
      scoredCount: _count.scores,
      sampleSize: sample.length,
      canScore: row.status === "in_progress" && canScore(ctx, row),
    }));
}

/** What the caller may start an assessment on: chosen editions and departments they score. */
export async function getStartOptions(ctx: AccessContext, facilityId: string) {
  if (!(await getFacility(ctx, facilityId))) return null;
  const [frameworks, departments] = await Promise.all([
    listFacilityFrameworks(ctx, facilityId),
    listDepartments(ctx, facilityId),
  ]);
  return {
    frameworks,
    wholeFacility: allowed(ctx, "assessment.score", { facilityId, departmentId: null }),
    departments: departments
      .filter((d) => allowed(ctx, "assessment.score", { facilityId, departmentId: d.id }))
      .map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn, typeCode: d.typeCode })),
  };
}

const startInput = z.object({
  frameworkId: z.uuid(),
  departmentId: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((value) => value || null),
});

/**
 * Starts a self-assessment of the whole facility or of one department, against one of the
 * editions the facility uses. A department with nothing to score (no type, or no element
 * tied to its type) cannot be assessed: an empty assessment would claim compliance.
 */
export async function startAssessment(
  ctx: AccessContext,
  facilityId: string,
  input: z.input<typeof startInput>,
  now = new Date(),
) {
  const data = startInput.parse(input);
  const scope = { facilityId, departmentId: data.departmentId };
  if (!allowed(ctx, "assessment.score", scope)) throw new ForbiddenError("assessment.score");
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("assessment.score");

  const content = await getScoringContent(ctx, facilityId, data.frameworkId);
  if (!content) throw new DomainError<AssessmentError>("unknownFramework");
  let departmentType: string | null | undefined;
  if (data.departmentId) {
    const department = (await listDepartments(ctx, facilityId)).find(
      (d) => d.id === data.departmentId,
    );
    if (!department) throw new DomainError<AssessmentError>("unknownDepartment");
    departmentType = department.typeCode;
  }
  if (scopeElements(content, departmentType).length === 0) {
    throw new DomainError<AssessmentError>("nothingToScore");
  }

  return withTenant(ctx, async (tx) => {
    const { id } = await repo.insertAssessment(tx, ctx.tenantId, {
      facilityId,
      frameworkId: data.frameworkId,
      departmentId: data.departmentId,
      startedBy: ctx.userId,
      startedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "create",
      entity: "assessment",
      entityId: id,
      after: {
        kind: "self",
        source: "internal",
        framework: `${content.framework.code} ${content.framework.edition}`,
        departmentId: data.departmentId,
      },
    });
    return id;
  });
}

// --- The scoring sheet ----------------------------------------------------------------------

/**
 * One assessment as the scoring sheet shows it: the elements in scope, grouped by chapter and
 * standard, each with its score and evidence; the assessment's own score so far; and, once
 * submitted, the findings it raised.
 */
export async function getAssessmentSheet(ctx: AccessContext, assessmentId: string) {
  const assessment = await loadAssessment(ctx, assessmentId);
  if (!assessment) return null;
  const content = await getScoringContent(ctx, assessment.facilityId, assessment.frameworkId);
  if (!content) return null;
  const scores = await withTenant(ctx, (tx) => repo.listScores(tx, ctx.tenantId, assessment.id));
  const scoreByElement = new Map(scores.map((s) => [s.elementId, s]));
  const scope = assessmentScope(content, assessment);
  const inScopeIds = new Set(scope.map((e) => e.id));

  const standards = content.standards
    .map((standard) => ({
      ...standard,
      elements: scope
        .filter((e) => e.standardId === standard.id)
        .map((e) => {
          const score = scoreByElement.get(e.id);
          return {
            id: e.id,
            code: e.code,
            titleAr: e.titleAr,
            titleEn: e.titleEn,
            descriptionAr: e.descriptionAr,
            descriptionEn: e.descriptionEn,
            isEsr: e.isEsr,
            evidenceTypes: e.evidenceTypes,
            score: score
              ? {
                  levelCode: score.level.code,
                  comment: score.comment,
                  scoredAt: score.scoredAt,
                  evidence: score.evidence,
                }
              : null,
          };
        }),
    }))
    .filter((s) => s.elements.length > 0);
  const chapters = content.chapters
    .map((chapter) => ({
      ...chapter,
      standards: standards.filter((s) => s.chapterId === chapter.id),
    }))
    .filter((c) => c.standards.length > 0);

  const scoredIds = new Set(scores.map((s) => s.elementId).filter((id) => inScopeIds.has(id)));
  const rollup = computeRollup(
    {
      chapters: content.chapters,
      standards: content.standards,
      elements: scope.map((e) => ({
        ...e,
        levelCode: scoreByElement.get(e.id)?.level.code ?? null,
      })),
    },
    content.scale,
    rollupSettingsFrom(content.rollupConfig),
  );
  const findings =
    assessment.status === "submitted"
      ? await listFindings(ctx, assessment.facilityId, { assessmentId: assessment.id })
      : [];

  return {
    assessment,
    framework: content.framework,
    scale: content.scale,
    esrAllowedLevels: content.rollupConfig.esr.allowed_levels,
    canScore: assessment.status === "in_progress" && canScore(ctx, assessment),
    progress: progress(scope, scoredIds),
    score: rollup.facility,
    chapters,
    findings,
  };
}
export type AssessmentSheet = NonNullable<Awaited<ReturnType<typeof getAssessmentSheet>>>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const scoreInput = z.object({
  levelCode: z.string().trim().min(1).max(40),
  comment: optionalText(evidenceLimits.comment),
  evidence: z
    .object({
      kind: z.enum(evidenceKinds),
      note: optionalText(evidenceLimits.note),
      url: optionalText(evidenceLimits.url),
      documentVersionId: z
        .union([z.uuid(), z.literal("")])
        .nullish()
        .transform((value) => value || null),
    })
    .nullish(),
});
export type ScoreInput = z.input<typeof scoreInput>;

/**
 * Scores one element, optionally adding a piece of evidence in the same step. The score is
 * stamped with server time on every save. Saving, then checking the rules against what is
 * stored, keeps the check honest about evidence added earlier; a broken rule rolls the whole
 * save back.
 */
export async function saveElementScore(
  ctx: AccessContext,
  assessmentId: string,
  elementId: string,
  input: ScoreInput,
  now = new Date(),
) {
  const data = scoreInput.parse(input);
  const { assessment, content } = await loadForScoring(ctx, assessmentId);
  const element = assessmentScope(content, assessment).find((e) => e.id === elementId);
  if (!element) throw new DomainError<AssessmentError>("unknownElement");
  const level = content.scale.find((l) => l.code === data.levelCode);
  if (!level) throw new DomainError<AssessmentError>("unknownLevel");
  let evidence: (typeof data)["evidence"] = null;
  if (data.evidence) {
    const problem = evidenceProblem(data.evidence);
    if (problem) throw new DomainError<AssessmentError>(problem);
    evidence = data.evidence;
    if (evidence.kind !== "document") {
      evidence = { ...evidence, documentVersionId: null };
    } else if (evidence.documentVersionId) {
      // Rule 8: only an approved version in force counts. A library citation replaces a link.
      const version = await findCitableVersion(
        ctx,
        assessment.facilityId,
        evidence.documentVersionId,
        now,
      );
      if (!version) throw new DomainError<AssessmentError>("documentNotCitable");
      evidence = { ...evidence, url: null };
    }
  }

  return withTenant(ctx, async (tx) => {
    if ((await repo.lockAssessment(tx, ctx.tenantId, assessment.id)) !== "in_progress") {
      throw new DomainError<AssessmentError>("assessmentSubmitted");
    }
    const before = await repo.findScore(tx, ctx.tenantId, assessment.id, element.id);
    const score = await repo.upsertScore(tx, ctx.tenantId, {
      assessmentId: assessment.id,
      elementId: element.id,
      scoreLevelId: level.id,
      comment: data.comment,
      scoredBy: ctx.userId,
      scoredAt: now,
    });
    let evidenceId: string | null = null;
    if (evidence) {
      evidenceId = (
        await repo.insertEvidence(tx, ctx.tenantId, {
          elementScoreId: score.id,
          kind: evidence.kind,
          note: evidence.note,
          url: evidence.url,
          documentVersionId: evidence.documentVersionId,
          createdBy: ctx.userId,
        })
      ).id;
    }
    const evidenceCount = await repo.countEvidence(tx, ctx.tenantId, score.id);
    const [problem] = elementScoreProblems(
      {
        levelCode: level.code,
        isEsr: element.isEsr,
        applicable: true,
        evidenceCount,
        comment: data.comment,
      },
      content.scale,
      {
        allowedLevels: content.rollupConfig.esr.allowed_levels,
        anyNotMetBlocksReadiness: content.rollupConfig.esr.any_not_met_blocks_readiness,
      },
    );
    if (problem) throw new DomainError<AssessmentError>(problem);

    await recordAudit(tx, ctx, {
      action: before ? "update" : "create",
      entity: "element_score",
      entityId: score.id,
      before: before && { levelCode: before.level.code, comment: before.comment },
      after: {
        assessmentId: assessment.id,
        element: element.code,
        levelCode: level.code,
        comment: data.comment,
      },
    });
    if (evidence && evidenceId) {
      // The kind and what it points at only: notes stay in the record, not in the audit trail.
      await recordAudit(tx, ctx, {
        action: "create",
        entity: "score_evidence",
        entityId: evidenceId,
        after: {
          elementScoreId: score.id,
          kind: evidence.kind,
          url: evidence.url,
          documentVersionId: evidence.documentVersionId,
        },
      });
    }
    return { scoreId: score.id, evidenceId };
  });
}

/** Removes a piece of evidence, unless the score it backs would then need evidence it lacks. */
export async function removeEvidence(ctx: AccessContext, evidenceId: string) {
  if (!z.uuid().safeParse(evidenceId).success) throw new DomainError<AssessmentError>("notFound");
  const evidence = await withTenant(ctx, (tx) => repo.findEvidence(tx, ctx.tenantId, evidenceId));
  if (!evidence) throw new DomainError<AssessmentError>("notFound");
  const { assessment, content } = await loadForScoring(ctx, evidence.elementScore.assessmentId);
  const element = content.elements.find((e) => e.id === evidence.elementScore.elementId);
  const level = findLevel(content.scale, evidence.elementScore.level.code);

  return withTenant(ctx, async (tx) => {
    if ((await repo.lockAssessment(tx, ctx.tenantId, assessment.id)) !== "in_progress") {
      throw new DomainError<AssessmentError>("assessmentSubmitted");
    }
    await repo.deleteEvidence(tx, ctx.tenantId, evidence.id);
    const remaining = await repo.countEvidence(tx, ctx.tenantId, evidence.elementScore.id);
    if (level?.requiresEvidence && remaining < 1) {
      throw new DomainError<AssessmentError>("evidenceRequired");
    }
    await recordAudit(tx, ctx, {
      action: "delete",
      entity: "score_evidence",
      entityId: evidence.id,
      before: {
        elementScoreId: evidence.elementScore.id,
        element: element?.code ?? null,
        kind: evidence.kind,
        url: evidence.url,
      },
    });
  });
}

/**
 * Submits and locks an assessment. Every element in scope must be scored. The scores become
 * the elements' current status (unless a newer score already holds it), and every score at a
 * level that generates findings raises one, all in one transaction. After this the database
 * refuses any change to the assessment, its scores or its evidence.
 */
export async function submitAssessment(ctx: AccessContext, assessmentId: string, now = new Date()) {
  const { assessment, content } = await loadForScoring(ctx, assessmentId);
  const scope = assessmentScope(content, assessment);
  const byId = new Map(scope.map((e) => [e.id, e]));

  return withTenant(ctx, async (tx) => {
    if ((await repo.lockAssessment(tx, ctx.tenantId, assessment.id)) !== "in_progress") {
      throw new DomainError<AssessmentError>("assessmentSubmitted");
    }
    // Scores for elements no longer in scope (ruled out since) stay on record but count for
    // nothing.
    const scores = (await repo.listScores(tx, ctx.tenantId, assessment.id)).filter((s) =>
      byId.has(s.elementId),
    );
    if (unscoredElements(scope, new Set(scores.map((s) => s.elementId))).length > 0) {
      throw new DomainError<AssessmentError>("incomplete");
    }

    const current = (
      await repo.listStatuses(tx, ctx.tenantId, assessment.facilityId, [...byId.keys()])
    ).map(toStatusRecord);
    const updates = statusUpdatesOnSubmit({
      source: assessment.source,
      scores: scores.map((s) => ({
        elementId: s.elementId,
        scoreId: s.id,
        levelCode: s.level.code,
        scoredAt: s.scoredAt,
      })),
      current,
    });
    for (const update of updates) {
      await repo.upsertStatus(tx, ctx.tenantId, assessment.facilityId, {
        elementId: update.elementId,
        source: update.source,
        elementScoreId: update.scoreId,
        levelCode: update.levelCode,
        verifiedAt: update.verifiedAt,
        expiresAt: update.expiresAt,
      });
    }

    const findingIds = await raiseFindings(
      tx,
      ctx,
      scores.flatMap((s) => {
        const level = findLevel(content.scale, s.level.code);
        const element = byId.get(s.elementId)!;
        if (!level?.generatesFinding) return [];
        return [
          {
            facilityId: assessment.facilityId,
            assessmentId: assessment.id,
            elementScoreId: s.id,
            elementId: s.elementId,
            elementCode: element.code,
            departmentId: assessment.departmentId,
            levelCode: level.code,
            isEsr: element.isEsr,
            normalized: normalizedValue(level, content.scale) ?? 0,
            comment: s.comment,
          },
        ];
      }),
    );

    const verified = await verifyFindings(
      tx,
      ctx,
      {
        facilityId: assessment.facilityId,
        departmentId: assessment.departmentId,
        scores: scores.map((s) => {
          const level = findLevel(content.scale, s.level.code);
          return {
            elementId: s.elementId,
            scoreId: s.id,
            normalized: level ? (normalizedValue(level, content.scale) ?? 0) : 0,
            scoredAt: s.scoredAt,
          };
        }),
      },
      now,
    );

    await repo.markSubmitted(tx, ctx.tenantId, assessment.id, ctx.userId, now);
    await recordAudit(tx, ctx, {
      action: "submit",
      entity: "assessment",
      entityId: assessment.id,
      before: { status: "in_progress" },
      after: {
        status: "submitted",
        scores: scores.length,
        statusesUpdated: updates.length,
        findings: findingIds.length,
        findingsVerified: verified,
      },
    });
    return { findings: findingIds.length, statusesUpdated: updates.length, verified };
  });
}

// --- Sampled assessments (tracers) ------------------------------------------------------------

export type CandidateState = "unverified" | "failing" | "met";

/**
 * The elements a tracer could check, with what is known about each: unverified (never scored
 * or expired), failing (current score short of full compliance) or met, with when it was
 * verified. The pool is the department's scope (or the whole facility), narrowed to the
 * chosen chapters when there are any. Null when the edition is not the facility's.
 */
export async function listTracerCandidates(
  ctx: AccessContext,
  facilityId: string,
  input: { frameworkId: string; departmentId: string | null; chapterIds: readonly string[] },
  now = new Date(),
) {
  const content = await getScoringContent(ctx, facilityId, input.frameworkId);
  if (!content) return null;
  let departmentType: string | null | undefined;
  if (input.departmentId) {
    const department = (await listDepartments(ctx, facilityId)).find(
      (d) => d.id === input.departmentId,
    );
    if (!department) return null;
    departmentType = department.typeCode;
  }
  const chapters = new Set(input.chapterIds);
  const chapterOf = new Map(content.standards.map((s) => [s.id, s.chapterId]));
  const pool = scopeElements(content, departmentType).filter(
    (e) => chapters.size === 0 || chapters.has(chapterOf.get(e.standardId) ?? ""),
  );
  const statuses = new Map(
    (
      await withTenant(ctx, (tx) =>
        repo.listStatuses(
          tx,
          ctx.tenantId,
          facilityId,
          pool.map((e) => e.id),
        ),
      )
    )
      .filter((s) => s.source === "internal")
      .map((s) => [s.elementId, toStatusRecord(s)]),
  );
  return {
    framework: content.framework,
    chapterIds: content.chapters.map((c) => c.id),
    validityDays: defaultScoreValidityDays,
    candidates: pool.map((e) => {
      const status = statuses.get(e.id);
      if (!status || elementState(status, now) !== "current") {
        return { elementId: e.id, state: "unverified" as CandidateState, verifiedAt: null };
      }
      const level = findLevel(content.scale, status.levelCode);
      const normalized = level ? normalizedValue(level, content.scale) : 0;
      return {
        elementId: e.id,
        state: (normalized === null || normalized >= 1 ? "met" : "failing") as CandidateState,
        verifiedAt: status.verifiedAt,
      };
    }),
  };
}

/**
 * Starts an assessment over a fixed sample of elements, inside the caller's transaction
 * (the tracers module records how the sample was drawn in the same one). The caller checks
 * the right to start it; the run is then scored under `tracer.run` by its assignee or by
 * anyone who manages the scope.
 */
export async function createSampledAssessment(
  tx: Tx,
  ctx: AccessContext,
  input: {
    facilityId: string;
    frameworkId: string;
    departmentId: string | null;
    elementIds: readonly string[];
    assignedTo: string;
    now: Date;
  },
) {
  const { id } = await repo.insertAssessment(tx, ctx.tenantId, {
    facilityId: input.facilityId,
    frameworkId: input.frameworkId,
    departmentId: input.departmentId,
    startedBy: ctx.userId,
    startedAt: input.now,
    kind: "tracer",
    assignedTo: input.assignedTo,
  });
  await repo.insertSample(tx, ctx.tenantId, id, input.elementIds);
  await recordAudit(tx, ctx, {
    action: "create",
    entity: "assessment",
    entityId: id,
    after: {
      kind: "tracer",
      source: "internal",
      departmentId: input.departmentId,
      assignedTo: input.assignedTo,
      sample: input.elementIds.length,
    },
  });
  return id;
}

// --- Readiness ------------------------------------------------------------------------------

function toStatusRecord(row: Awaited<ReturnType<typeof repo.listStatuses>>[number]) {
  return {
    elementId: row.elementId,
    source: row.source,
    scoreId: row.elementScoreId,
    levelCode: row.levelCode,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
  } satisfies ElementStatusRecord;
}

/**
 * The facility's readiness against each edition it uses, from the internal series as of
 * `now`: current levels, roll-up, then the ESR and threshold rules, with the facility's
 * overdue CAPA items.
 */
export async function getReadiness(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!allowed(ctx, "dashboard.view", { facilityId })) return [];
  const frameworks = await listFacilityFrameworks(ctx, facilityId);
  if (frameworks.length === 0) return [];
  const statuses = (
    await withTenant(ctx, (tx) => repo.listStatuses(tx, ctx.tenantId, facilityId))
  ).map(toStatusRecord);
  const overdueCapa = await countOverdueCapa(ctx, facilityId, now);

  const results = [];
  for (const framework of frameworks) {
    const content = await getScoringContent(ctx, facilityId, framework.id);
    if (!content) continue;
    const ids = new Set(content.elements.map((e) => e.id));
    const own = statuses.filter((s) => ids.has(s.elementId));
    const verdict = evaluateFacility({
      content,
      scale: content.scale,
      rollup: rollupSettingsFrom(content.rollupConfig),
      esr: { anyNotMetBlocksReadiness: content.rollupConfig.esr.any_not_met_blocks_readiness },
      readiness: defaultReadinessSettings,
      statuses: own,
      source: "internal",
      overdueCapa,
      now,
    });
    results.push({
      framework: content.framework,
      status: verdict.status,
      reasons: verdict.reasons,
      score: verdict.rollup.facility.score,
      counted: verdict.rollup.facility.counted,
      scored: verdict.rollup.facility.scored,
      esrNotMet: verdict.rollup.facility.esrNotMet,
      esrUnverified: verdict.rollup.facility.esrUnverified,
      overdueCapa,
      expired: own.filter((s) => s.source === "internal" && elementState(s, now) === "expired")
        .length,
    });
  }
  return results;
}
export type FacilityReadiness = Awaited<ReturnType<typeof getReadiness>>[number];
