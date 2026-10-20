import type { Tx } from "@/lib/db";
import type { AssessmentKind, EvidenceKind } from "./domain/assessment";
import type { ScoreSource } from "./domain/expiry";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

const assessmentSelect = {
  id: true,
  facilityId: true,
  frameworkId: true,
  departmentId: true,
  kind: true,
  source: true,
  status: true,
  startedBy: true,
  startedAt: true,
  submittedBy: true,
  submittedAt: true,
  assignedTo: true,
  framework: { select: { code: true, edition: true, nameAr: true, nameEn: true } },
  department: { select: { nameAr: true, nameEn: true, typeCode: true } },
  sample: { select: { elementId: true } },
  _count: { select: { scores: true } },
} as const;

export function listAssessments(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  kind: AssessmentKind,
) {
  return tx.assessment.findMany({
    where: { tenantId, facilityId, kind },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: assessmentSelect,
  });
}

export function findAssessment(tx: Tx, tenantId: string, id: string) {
  return tx.assessment.findFirst({ where: { tenantId, id }, select: assessmentSelect });
}

/** Locks the row for the rest of the transaction, so two submits cannot both go through. */
export async function lockAssessment(tx: Tx, tenantId: string, id: string) {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text FROM assessment WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE`;
  return rows[0]?.status ?? null;
}

export function insertAssessment(
  tx: Tx,
  tenantId: string,
  data: {
    facilityId: string;
    frameworkId: string;
    departmentId: string | null;
    startedBy: string;
    startedAt: Date;
    kind?: AssessmentKind;
    source?: ScoreSource;
    assignedTo?: string | null;
  },
) {
  return tx.assessment.create({ data: { tenantId, ...data }, select: { id: true } });
}

/** Fixes the elements a sampled assessment covers. */
export function insertSample(
  tx: Tx,
  tenantId: string,
  assessmentId: string,
  elementIds: readonly string[],
) {
  return tx.assessmentElement.createMany({
    data: elementIds.map((elementId) => ({ tenantId, assessmentId, elementId })),
  });
}

export function markSubmitted(
  tx: Tx,
  tenantId: string,
  id: string,
  submittedBy: string,
  submittedAt: Date,
) {
  return tx.assessment.updateMany({
    where: { tenantId, id, status: "in_progress" },
    data: { status: "submitted", submittedBy, submittedAt },
  });
}

// --- Scores and evidence --------------------------------------------------------------------

export function listScores(tx: Tx, tenantId: string, assessmentId: string) {
  return tx.elementScore.findMany({
    where: { tenantId, assessmentId },
    select: {
      id: true,
      elementId: true,
      comment: true,
      scoredBy: true,
      scoredAt: true,
      level: { select: { code: true } },
      evidence: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          note: true,
          url: true,
          createdAt: true,
          documentVersion: {
            select: {
              id: true,
              version: true,
              document: { select: { id: true, titleAr: true, titleEn: true } },
            },
          },
        },
      },
    },
  });
}

export function findScore(tx: Tx, tenantId: string, assessmentId: string, elementId: string) {
  return tx.elementScore.findFirst({
    where: { tenantId, assessmentId, elementId },
    select: {
      id: true,
      comment: true,
      level: { select: { code: true } },
      _count: { select: { evidence: true } },
    },
  });
}

export function upsertScore(
  tx: Tx,
  tenantId: string,
  data: {
    assessmentId: string;
    elementId: string;
    scoreLevelId: string;
    comment: string | null;
    scoredBy: string;
    scoredAt: Date;
  },
) {
  const { assessmentId, elementId, ...score } = data;
  return tx.elementScore.upsert({
    where: { assessmentId_elementId: { assessmentId, elementId } },
    create: { tenantId, assessmentId, elementId, ...score },
    update: score,
    select: { id: true },
  });
}

export function insertEvidence(
  tx: Tx,
  tenantId: string,
  data: {
    elementScoreId: string;
    kind: EvidenceKind;
    note: string | null;
    url: string | null;
    documentVersionId: string | null;
    createdBy: string;
  },
) {
  return tx.scoreEvidence.create({ data: { tenantId, ...data }, select: { id: true } });
}

export function countEvidence(tx: Tx, tenantId: string, elementScoreId: string) {
  return tx.scoreEvidence.count({ where: { tenantId, elementScoreId } });
}

export function findEvidence(tx: Tx, tenantId: string, id: string) {
  return tx.scoreEvidence.findFirst({
    where: { tenantId, id },
    select: {
      id: true,
      kind: true,
      note: true,
      url: true,
      elementScore: {
        select: {
          id: true,
          assessmentId: true,
          elementId: true,
          comment: true,
          level: { select: { code: true } },
        },
      },
    },
  });
}

export function deleteEvidence(tx: Tx, tenantId: string, id: string) {
  return tx.scoreEvidence.deleteMany({ where: { tenantId, id } });
}

// --- Element status -------------------------------------------------------------------------

export function listStatuses(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  elementIds?: readonly string[],
) {
  return tx.elementStatus.findMany({
    where: {
      tenantId,
      facilityId,
      ...(elementIds ? { elementId: { in: [...elementIds] } } : {}),
    },
    select: {
      elementId: true,
      source: true,
      elementScoreId: true,
      levelCode: true,
      verifiedAt: true,
      expiresAt: true,
    },
  });
}

export function upsertStatus(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  data: {
    elementId: string;
    source: ScoreSource;
    elementScoreId: string;
    levelCode: string;
    verifiedAt: Date;
    expiresAt: Date | null;
  },
) {
  const { elementId, source, ...status } = data;
  return tx.elementStatus.upsert({
    where: { facilityId_elementId_source: { facilityId, elementId, source } },
    create: { tenantId, facilityId, elementId, source, ...status },
    update: status,
  });
}

/** Library versions cited as evidence by these scores. */
export async function listCitedVersions(tx: Tx, tenantId: string, scoreIds: readonly string[]) {
  const rows = await tx.scoreEvidence.findMany({
    where: { tenantId, elementScoreId: { in: [...scoreIds] }, documentVersionId: { not: null } },
    select: { elementScoreId: true, documentVersionId: true },
  });
  return rows.map((r) => ({
    elementScoreId: r.elementScoreId,
    documentVersionId: r.documentVersionId!,
  }));
}
