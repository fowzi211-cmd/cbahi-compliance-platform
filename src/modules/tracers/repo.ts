import type { Tx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { TracerFrequency } from "./domain/schedule";

// Tenant-owned; every query runs inside withTenant() and still names the tenant.

const templateSelect = {
  id: true,
  facilityId: true,
  frameworkId: true,
  departmentId: true,
  nameAr: true,
  nameEn: true,
  sampleSize: true,
  frequency: true,
  assigneeUserId: true,
  createdAt: true,
  archivedAt: true,
  framework: { select: { code: true, edition: true, nameAr: true, nameEn: true, status: true } },
  department: { select: { nameAr: true, nameEn: true } },
  chapters: { select: { chapterId: true } },
} as const;

export function listTemplates(tx: Tx, tenantId: string, facilityId: string) {
  return tx.tracerTemplate.findMany({
    where: { tenantId, facilityId, archivedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: templateSelect,
  });
}

export function findTemplate(tx: Tx, tenantId: string, id: string) {
  return tx.tracerTemplate.findFirst({ where: { tenantId, id }, select: templateSelect });
}

/** Locks the template for the rest of the transaction, so two starts cannot both go through. */
export async function lockTemplate(tx: Tx, tenantId: string, id: string) {
  await tx.$queryRaw`
    SELECT 1 FROM tracer_template WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE`;
}

export async function insertTemplate(
  tx: Tx,
  tenantId: string,
  data: {
    facilityId: string;
    frameworkId: string;
    departmentId: string | null;
    nameAr: string | null;
    nameEn: string | null;
    sampleSize: number;
    frequency: TracerFrequency;
    assigneeUserId: string | null;
    createdBy: string;
    createdAt: Date;
    chapterIds: readonly string[];
  },
) {
  const { chapterIds, ...template } = data;
  const { id } = await tx.tracerTemplate.create({
    data: { tenantId, ...template },
    select: { id: true },
  });
  await tx.tracerTemplateChapter.createMany({
    data: chapterIds.map((chapterId) => ({ tenantId, templateId: id, chapterId })),
  });
  return { id };
}

export function archiveTemplate(tx: Tx, tenantId: string, id: string, archivedAt: Date) {
  return tx.tracerTemplate.updateMany({
    where: { tenantId, id, archivedAt: null },
    data: { archivedAt },
  });
}

// --- Runs -----------------------------------------------------------------------------------

const runSelect = {
  assessmentId: true,
  templateId: true,
  seed: true,
  candidates: true,
  sampleSize: true,
  createdAt: true,
} as const;

export function insertRun(
  tx: Tx,
  tenantId: string,
  data: {
    assessmentId: string;
    templateId: string;
    seed: string;
    candidates: Prisma.InputJsonValue;
    sampleSize: number;
    createdAt: Date;
  },
) {
  return tx.tracerRun.create({ data: { tenantId, ...data }, select: { assessmentId: true } });
}

export function listRuns(tx: Tx, tenantId: string, templateIds: readonly string[]) {
  return tx.tracerRun.findMany({
    where: { tenantId, templateId: { in: [...templateIds] } },
    orderBy: [{ createdAt: "desc" }, { assessmentId: "desc" }],
    select: { assessmentId: true, templateId: true, sampleSize: true, createdAt: true },
  });
}

export function findRun(tx: Tx, tenantId: string, assessmentId: string) {
  return tx.tracerRun.findFirst({ where: { tenantId, assessmentId }, select: runSelect });
}

/** The run of a template still being walked, if any. */
export function findOpenRun(tx: Tx, tenantId: string, templateId: string) {
  return tx.tracerRun.findFirst({
    where: { tenantId, templateId, assessment: { status: "in_progress" } },
    select: { assessmentId: true },
  });
}
