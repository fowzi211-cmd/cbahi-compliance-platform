import { uuidv7 } from "uuidv7";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import type { BrowseChapter, BrowseElement, BrowseStandard } from "./domain/browse";
import type { EditionContent } from "./domain/diff";
import type { FrameworkStatus } from "./domain/editions";
import type { ImportDocument, ImportFormat, ScoreLevelInput } from "./domain/import-format";

// The library is global. Tenant requests read it as the app role, where RLS hides drafts;
// the platform admin reads and writes it through the system role. Nothing here filters by
// tenant because no row belongs to one.

export function loadCatalogues(tx: Tx) {
  return Promise.all([
    tx.facilityType.findMany({ orderBy: { sort: "asc" } }),
    tx.departmentType.findMany({ orderBy: { sort: "asc" } }),
  ]);
}

export function listDepartmentTypes(tx: Tx) {
  return tx.departmentType.findMany({ orderBy: { sort: "asc" } });
}

// --- Imports ---------------------------------------------------------------------------------

export function insertImport(
  tx: Tx,
  data: {
    fileName: string;
    fileSha256: Uint8Array;
    format: ImportFormat;
    document: ImportDocument;
    report: Prisma.InputJsonValue;
    createdBy: string;
  },
) {
  return tx.frameworkImport.create({
    data: {
      ...data,
      fileSha256: Buffer.from(data.fileSha256),
      document: data.document as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export function findImport(tx: Tx, id: string) {
  return tx.frameworkImport.findUnique({ where: { id } });
}

export function listPendingImports(tx: Tx) {
  return tx.frameworkImport.findMany({
    where: { status: "validated" },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, format: true, createdAt: true, report: true },
  });
}

/** Moves an import out of `validated`; returns false if someone else already did. */
export async function closeImport(
  tx: Tx,
  id: string,
  data: { status: "committed" | "discarded"; frameworkId?: string; committedAt?: Date },
) {
  const { count } = await tx.frameworkImport.updateMany({
    where: { id, status: "validated" },
    data,
  });
  return count === 1;
}

// --- Editions --------------------------------------------------------------------------------

const editionSelect = {
  id: true,
  code: true,
  edition: true,
  nameAr: true,
  nameEn: true,
  program: true,
  status: true,
  licenseNote: true,
  activatedAt: true,
  retiredAt: true,
  createdAt: true,
  _count: { select: { chapters: true, standards: true, elements: true } },
} as const;

export function editionExists(tx: Tx, code: string, edition: string) {
  return tx.framework
    .findUnique({ where: { code_edition: { code, edition } }, select: { id: true } })
    .then(Boolean);
}

export function findEdition(tx: Tx, id: string) {
  return tx.framework.findUnique({ where: { id }, select: editionSelect });
}

export function listEditions(tx: Tx, where: Prisma.FrameworkWhereInput = {}) {
  return tx.framework.findMany({
    where,
    orderBy: [{ code: "asc" }, { createdAt: "desc" }],
    select: editionSelect,
  });
}

export function countEsr(tx: Tx, frameworkIds: string[]) {
  return tx.element
    .groupBy({
      by: ["frameworkId"],
      where: { frameworkId: { in: frameworkIds }, isEsr: true },
      _count: true,
    })
    .then((rows) => new Map(rows.map((r) => [r.frameworkId, r._count])));
}

export function findActiveEdition(tx: Tx, code: string) {
  return tx.framework.findFirst({
    where: { code, status: "active" },
    select: { id: true, edition: true },
  });
}

/** The edition a new import is compared with: the live one, else the most recent. */
export function findReferenceEdition(tx: Tx, code: string) {
  return tx.framework
    .findFirst({
      where: { code, status: { not: "draft" } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { id: true, edition: true },
    })
    .then(
      async (published) =>
        published ??
        tx.framework.findFirst({
          where: { code },
          orderBy: { createdAt: "desc" },
          select: { id: true, edition: true },
        }),
    );
}

export async function findEditionContent(tx: Tx, frameworkId: string): Promise<EditionContent> {
  const [chapters, standards, elements] = await Promise.all([
    tx.chapter.findMany({ where: { frameworkId }, orderBy: { sort: "asc" } }),
    tx.standard.findMany({
      where: { frameworkId },
      orderBy: { sort: "asc" },
      include: { chapter: { select: { code: true } } },
    }),
    tx.element.findMany({
      where: { frameworkId },
      orderBy: { sort: "asc" },
      include: { standard: { select: { code: true } } },
    }),
  ]);
  return {
    chapters: chapters.map((c) => ({ code: c.code, titleAr: c.titleAr, titleEn: c.titleEn })),
    standards: standards.map((s) => ({
      code: s.code,
      chapterCode: s.chapter.code,
      titleAr: s.titleAr,
      titleEn: s.titleEn,
      weight: s.weight.toNumber(),
    })),
    elements: elements.map((e) => ({
      code: e.code,
      standardCode: e.standard.code,
      titleAr: e.titleAr,
      titleEn: e.titleEn,
      descriptionAr: e.descriptionAr,
      descriptionEn: e.descriptionEn,
      isEsr: e.isEsr,
      weight: e.weight.toNumber(),
      evidenceTypes: e.evidenceTypes as EditionContent["elements"][number]["evidenceTypes"],
      facilityTypes: e.facilityTypes,
      departmentTypes: e.departmentTypes,
    })),
  };
}

/** Writes a whole edition as a draft. Ids are generated here so rows can be inserted in bulk. */
export async function insertEdition(tx: Tx, document: ImportDocument, createdBy: string | null) {
  const frameworkId = uuidv7();
  const { framework } = document;
  await tx.framework.create({
    data: {
      id: frameworkId,
      code: framework.code,
      edition: framework.edition,
      nameAr: framework.nameAr,
      nameEn: framework.nameEn,
      program: framework.program,
      rollupConfig: framework.rollupConfig,
      createdBy,
    },
  });
  await tx.scoreLevel.createMany({
    data: document.scale.map((level: ScoreLevelInput, sort) => ({ ...level, frameworkId, sort })),
  });

  const chapterIds = new Map(document.chapters.map((c) => [c.code, uuidv7()]));
  await tx.chapter.createMany({
    data: document.chapters.map((c, sort) => ({
      id: chapterIds.get(c.code)!,
      frameworkId,
      code: c.code,
      titleAr: c.titleAr,
      titleEn: c.titleEn,
      sort,
    })),
  });

  const standardIds = new Map(document.standards.map((s) => [s.code, uuidv7()]));
  await tx.standard.createMany({
    data: document.standards.map((s, sort) => ({
      id: standardIds.get(s.code)!,
      frameworkId,
      chapterId: chapterIds.get(s.chapterCode)!,
      code: s.code,
      titleAr: s.titleAr,
      titleEn: s.titleEn,
      weight: s.weight,
      sort,
    })),
  });

  await tx.element.createMany({
    data: document.elements.map((e, sort) => ({
      frameworkId,
      standardId: standardIds.get(e.standardCode)!,
      code: e.code,
      titleAr: e.titleAr,
      titleEn: e.titleEn,
      descriptionAr: e.descriptionAr,
      descriptionEn: e.descriptionEn,
      isEsr: e.isEsr,
      weight: e.weight,
      sort,
      evidenceTypes: e.evidenceTypes,
      facilityTypes: e.facilityTypes,
      departmentTypes: e.departmentTypes,
    })),
  });
  return frameworkId;
}

export function updateEdition(
  tx: Tx,
  id: string,
  data: {
    status?: FrameworkStatus;
    licenseNote?: string | null;
    activatedAt?: Date;
    retiredAt?: Date;
  },
) {
  return tx.framework.update({ where: { id }, data, select: { id: true } });
}

export function deleteEdition(tx: Tx, id: string) {
  return tx.framework.delete({ where: { id }, select: { id: true } });
}

// --- Browsing --------------------------------------------------------------------------------

export async function findBrowseContent(tx: Tx, frameworkId: string) {
  const [scale, chapters, standards, elements] = await Promise.all([
    tx.scoreLevel.findMany({ where: { frameworkId }, orderBy: { sort: "asc" } }),
    tx.chapter.findMany({
      where: { frameworkId },
      select: { id: true, code: true, titleAr: true, titleEn: true, sort: true },
    }),
    tx.standard.findMany({
      where: { frameworkId },
      select: { id: true, chapterId: true, code: true, titleAr: true, titleEn: true, sort: true },
    }),
    tx.element.findMany({
      where: { frameworkId },
      select: {
        id: true,
        standardId: true,
        code: true,
        titleAr: true,
        titleEn: true,
        descriptionAr: true,
        descriptionEn: true,
        isEsr: true,
        weight: true,
        sort: true,
        evidenceTypes: true,
        facilityTypes: true,
        departmentTypes: true,
      },
    }),
  ]);
  return {
    scale: scale.map((l) => ({
      code: l.code,
      labelAr: l.labelAr,
      labelEn: l.labelEn,
      value: l.value.toNumber(),
      requiresEvidence: l.requiresEvidence,
      countsInDenominator: l.countsInDenominator,
    })),
    chapters: chapters satisfies BrowseChapter[],
    standards: standards satisfies BrowseStandard[],
    elements: elements.map((e) => ({
      ...e,
      weight: e.weight.toNumber(),
    })) satisfies BrowseElement[],
  };
}

// --- What applies to a facility (tenant-owned, M5) -------------------------------------------
// These tables belong to a tenant, so every query names the tenant as well as relying on RLS.

export function listFacilityFrameworks(tx: Tx, tenantId: string, facilityId: string) {
  return tx.facilityFramework.findMany({
    where: { tenantId, facilityId },
    orderBy: { createdAt: "asc" },
    select: {
      frameworkId: true,
      createdAt: true,
      framework: {
        select: {
          id: true,
          code: true,
          edition: true,
          nameAr: true,
          nameEn: true,
          program: true,
          status: true,
        },
      },
    },
  });
}

export function insertFacilityFrameworks(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  frameworkIds: string[],
  createdBy: string | null,
) {
  return tx.facilityFramework.createMany({
    data: frameworkIds.map((frameworkId) => ({ tenantId, facilityId, frameworkId, createdBy })),
  });
}

export function deleteFacilityFrameworks(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  frameworkIds: string[],
) {
  return tx.facilityFramework.deleteMany({
    where: { tenantId, facilityId, frameworkId: { in: frameworkIds } },
  });
}

/** The elements of one edition with their place in it, for the applicability screen. */
export async function listApplicabilityElements(tx: Tx, frameworkId: string) {
  const [chapters, standards, elements] = await Promise.all([
    tx.chapter.findMany({
      where: { frameworkId },
      orderBy: { sort: "asc" },
      select: { id: true, code: true, titleAr: true, titleEn: true },
    }),
    tx.standard.findMany({
      where: { frameworkId },
      select: { id: true, chapterId: true },
    }),
    tx.element.findMany({
      where: { frameworkId },
      orderBy: { sort: "asc" },
      select: {
        id: true,
        standardId: true,
        code: true,
        titleAr: true,
        titleEn: true,
        isEsr: true,
        facilityTypes: true,
      },
    }),
  ]);
  return { chapters, standards, elements };
}

export function listApplicabilityOverrides(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  elementIds?: string[],
) {
  return tx.elementApplicability.findMany({
    where: { tenantId, facilityId, ...(elementIds ? { elementId: { in: elementIds } } : {}) },
    select: {
      elementId: true,
      applicable: true,
      justification: true,
      decidedBy: true,
      decidedAt: true,
    },
  });
}

/** An element, only if it belongs to an edition the facility is assessed against. */
export function findFacilityElement(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  elementId: string,
) {
  return tx.element.findFirst({
    where: { id: elementId, framework: { facilities: { some: { tenantId, facilityId } } } },
    select: { id: true, code: true, frameworkId: true, isEsr: true, facilityTypes: true },
  });
}

export function upsertApplicability(
  tx: Tx,
  tenantId: string,
  data: {
    facilityId: string;
    elementId: string;
    applicable: boolean;
    justification: string | null;
    decidedBy: string | null;
    decidedAt: Date;
  },
) {
  const { facilityId, elementId, ...decision } = data;
  return tx.elementApplicability.upsert({
    where: { facilityId_elementId: { facilityId, elementId } },
    create: { tenantId, facilityId, elementId, ...decision },
    update: decision,
  });
}

export function deleteApplicability(
  tx: Tx,
  tenantId: string,
  facilityId: string,
  elementId: string,
) {
  return tx.elementApplicability.deleteMany({ where: { tenantId, facilityId, elementId } });
}
