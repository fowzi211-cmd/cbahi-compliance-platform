import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { withSystem, withTenant, type Tx } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { recordAudit, recordPlatformAudit } from "@/modules/audit/service";
import { allowed, getFacility, type AccessContext } from "@/modules/tenancy/service";
import {
  applicabilityChange,
  buildApplicabilityView,
  resolveApplicability,
  suggestedPrograms,
  type ApplicabilityFilter,
} from "./domain/applicability";
import { buildBrowseView, type BrowseFilter } from "./domain/browse";
import { diffEditions, type EditionDiff } from "./domain/diff";
import {
  activationBlocker,
  deletionBlocker,
  licenseNoteBlocker,
  retirementBlocker,
  type EditionBlocker,
} from "./domain/editions";
import {
  importDocumentSchema,
  limits,
  rollupConfigSchema,
  type ImportDocument,
  type ImportFormat,
} from "./domain/import-format";
import { hasErrors, type ImportIssue } from "./domain/issues";
import { validateWorkbook } from "./domain/validate";
import { readImportFile } from "./import-file";
import * as repo from "./repo";

export type { BrowseFilter } from "./domain/browse";
export type { EditionDiff } from "./domain/diff";
export type { FrameworkStatus } from "./domain/editions";
export type { ImportIssue, IssueCode } from "./domain/issues";
export { evidenceTypes, importFormats, limits, programs } from "./domain/import-format";
export { localized } from "./domain/display";
export { frameworkFormFields } from "./domain/readers";
export { justificationLimits } from "./domain/applicability";
export type {
  ApplicabilityElement,
  ApplicabilityFilter,
  ApplicabilityReason,
  ApplicabilityView,
} from "./domain/applicability";

/**
 * The platform admin, who maintains the library for every tenant. Not a tenant role: the
 * flag comes from the verified user profile (lib/session.ts, requirePlatformAdmin).
 */
export type PlatformActor = { userId: string; isPlatformAdmin: boolean };

export type EditionError = EditionBlocker | "notFound" | "importNotPending";

function authorizePlatform(actor: PlatformActor) {
  if (!actor.isPlatformAdmin) throw new ForbiddenError("standards.manage");
}

// --- Import -----------------------------------------------------------------------------------

export type ImportReport = {
  framework: Pick<
    ImportDocument["framework"],
    "code" | "edition" | "nameAr" | "nameEn" | "program"
  >;
  counts: {
    chapters: number;
    standards: number;
    elements: number;
    esr: number;
    scaleLevels: number;
  };
  warnings: ImportIssue[];
  diff: EditionDiff;
};

export type ImportPreview =
  { ok: false; issues: ImportIssue[] } | { ok: true; importId: string; warnings: number };

const frameworkMetaSchema = z.record(z.string(), z.string().trim().max(limits.titleLength));

/**
 * Reads and validates an uploaded file. A valid file is stored with its report so the admin
 * can review the preview and diff before committing; an invalid one is only reported back.
 */
export async function previewImport(
  actor: PlatformActor,
  input: { fileName: string; bytes: Uint8Array; framework: Record<string, string> },
): Promise<ImportPreview> {
  authorizePlatform(actor);
  const fileName = z.string().trim().min(1).max(255).parse(input.fileName);
  const read = await readImportFile({
    fileName,
    bytes: input.bytes,
    framework: frameworkMetaSchema.parse(input.framework),
  });
  if (!read.workbook || hasErrors(read.issues)) return { ok: false, issues: read.issues };

  return withSystem(async (tx) => {
    const [facilityTypes, departmentTypes] = await repo.loadCatalogues(tx);
    const { document, issues } = validateWorkbook(read.workbook!, {
      facilityTypes: new Set(facilityTypes.map((t) => t.code)),
      departmentTypes: new Set(departmentTypes.map((t) => t.code)),
    });
    const allIssues = [...read.issues, ...issues];
    if (!document) return { ok: false as const, issues: allIssues };

    const { code, edition } = document.framework;
    if (await repo.editionExists(tx, code, edition)) {
      return {
        ok: false as const,
        issues: [
          ...allIssues,
          {
            severity: "error" as const,
            code: "editionExists" as const,
            sheet: "framework" as const,
            column: "edition",
            value: `${code} ${edition}`,
          },
        ],
      };
    }

    const reference = await repo.findReferenceEdition(tx, code);
    const diff = diffEditions(
      reference
        ? { edition: reference.edition, content: await repo.findEditionContent(tx, reference.id) }
        : null,
      document,
    );
    const report: ImportReport = {
      framework: {
        code,
        edition,
        nameAr: document.framework.nameAr,
        nameEn: document.framework.nameEn,
        program: document.framework.program,
      },
      counts: {
        chapters: document.chapters.length,
        standards: document.standards.length,
        elements: document.elements.length,
        esr: document.elements.filter((e) => e.isEsr).length,
        scaleLevels: document.scale.length,
      },
      warnings: allIssues,
      diff,
    };
    const sha256 = createHash("sha256").update(input.bytes).digest();
    const row = await repo.insertImport(tx, {
      fileName,
      fileSha256: sha256,
      format: read.format as ImportFormat,
      document,
      report: report as unknown as Prisma.InputJsonValue,
      createdBy: actor.userId,
    });
    await recordPlatformAudit(tx, actor.userId, {
      action: "create",
      entity: "framework_import",
      entityId: row.id,
      // The file's fingerprint and what it contains; the text itself stays in the import row.
      after: {
        fileName,
        format: read.format,
        sha256: sha256.toString("hex"),
        code,
        edition,
        counts: report.counts,
      },
    });
    return { ok: true as const, importId: row.id, warnings: allIssues.length };
  });
}

export type PendingImport = {
  id: string;
  fileName: string;
  format: string;
  createdAt: Date;
  report: ImportReport;
};

export async function getImport(actor: PlatformActor, importId: string) {
  authorizePlatform(actor);
  const row = await withSystem((tx) => repo.findImport(tx, importId));
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    format: row.format,
    createdAt: row.createdAt,
    frameworkId: row.frameworkId,
    report: row.report as unknown as ImportReport,
  };
}

export async function listPendingImports(actor: PlatformActor): Promise<PendingImport[]> {
  authorizePlatform(actor);
  const rows = await withSystem((tx) => repo.listPendingImports(tx));
  return rows.map((r) => ({ ...r, report: r.report as unknown as ImportReport }));
}

/** Creates the draft edition from exactly what was previewed. */
export async function commitImport(actor: PlatformActor, importId: string, now = new Date()) {
  authorizePlatform(actor);
  return withSystem(async (tx) => {
    const row = await repo.findImport(tx, importId);
    if (!row) throw new DomainError<EditionError>("notFound");
    if (row.status !== "validated") throw new DomainError<EditionError>("importNotPending");
    // Re-checked at the trust boundary: the stored JSON is ours, but it is still input.
    const document = importDocumentSchema.parse(row.document);
    const { code, edition } = document.framework;
    if (await repo.editionExists(tx, code, edition)) {
      throw new DomainError<EditionError | "editionExists">("editionExists");
    }
    const frameworkId = await repo.insertEdition(tx, document, actor.userId);
    if (
      !(await repo.closeImport(tx, importId, {
        status: "committed",
        frameworkId,
        committedAt: now,
      }))
    ) {
      throw new DomainError<EditionError>("importNotPending");
    }
    await recordPlatformAudit(tx, actor.userId, {
      action: "create",
      entity: "framework",
      entityId: frameworkId,
      after: { code, edition, status: "draft", importId, elements: document.elements.length },
    });
    return frameworkId;
  });
}

export async function discardImport(actor: PlatformActor, importId: string) {
  authorizePlatform(actor);
  await withSystem(async (tx) => {
    if (!(await repo.closeImport(tx, importId, { status: "discarded" }))) {
      throw new DomainError<EditionError>("importNotPending");
    }
    await recordPlatformAudit(tx, actor.userId, {
      action: "update",
      entity: "framework_import",
      entityId: importId,
      before: { status: "validated" },
      after: { status: "discarded" },
    });
  });
}

// --- Editions ---------------------------------------------------------------------------------

export type EditionSummary = Awaited<ReturnType<typeof listEditions>>[number];

async function withEsrCounts<T extends { id: string }>(tx: Tx, editions: T[]) {
  const esr = await repo.countEsr(
    tx,
    editions.map((e) => e.id),
  );
  return editions.map((e) => ({ ...e, esrCount: esr.get(e.id) ?? 0 }));
}

export async function listEditions(actor: PlatformActor) {
  authorizePlatform(actor);
  return withSystem(async (tx) => withEsrCounts(tx, await repo.listEditions(tx)));
}

export async function getEdition(actor: PlatformActor, frameworkId: string) {
  authorizePlatform(actor);
  return withSystem(async (tx) => {
    const edition = await repo.findEdition(tx, frameworkId);
    return edition ? (await withEsrCounts(tx, [edition]))[0]! : null;
  });
}

async function loadForChange(tx: Tx, frameworkId: string) {
  const edition = await repo.findEdition(tx, frameworkId);
  if (!edition) throw new DomainError<EditionError>("notFound");
  return edition;
}

const licenseNoteSchema = z.string().trim().max(limits.licenseNoteLength);

export async function setLicenseNote(actor: PlatformActor, frameworkId: string, note: string) {
  authorizePlatform(actor);
  const value = licenseNoteSchema.parse(note);
  await withSystem(async (tx) => {
    const edition = await loadForChange(tx, frameworkId);
    const blocker = licenseNoteBlocker(edition, value);
    if (blocker) throw new DomainError<EditionError>(blocker);
    await repo.updateEdition(tx, frameworkId, { licenseNote: value === "" ? null : value });
    await recordPlatformAudit(tx, actor.userId, {
      action: "update",
      entity: "framework",
      entityId: frameworkId,
      before: { licenseNote: edition.licenseNote },
      after: { licenseNote: value === "" ? null : value },
    });
  });
}

/**
 * Puts a draft live. The edition it replaces is retired in the same transaction, so tenants
 * never see two live versions of one framework (also enforced by a partial unique index).
 */
export async function activateEdition(actor: PlatformActor, frameworkId: string, now = new Date()) {
  authorizePlatform(actor);
  await withSystem(async (tx) => {
    const edition = await loadForChange(tx, frameworkId);
    const blocker = activationBlocker(edition);
    if (blocker) throw new DomainError<EditionError>(blocker);

    const current = await repo.findActiveEdition(tx, edition.code);
    if (current) {
      await repo.updateEdition(tx, current.id, { status: "retired", retiredAt: now });
      await recordPlatformAudit(tx, actor.userId, {
        action: "retire",
        entity: "framework",
        entityId: current.id,
        before: { status: "active" },
        after: { status: "retired", replacedBy: frameworkId },
      });
    }
    await repo.updateEdition(tx, frameworkId, { status: "active", activatedAt: now });
    await recordPlatformAudit(tx, actor.userId, {
      action: "activate",
      entity: "framework",
      entityId: frameworkId,
      before: { status: "draft" },
      after: {
        status: "active",
        code: edition.code,
        edition: edition.edition,
        replaces: current?.id ?? null,
      },
    });
  });
}

export async function retireEdition(actor: PlatformActor, frameworkId: string, now = new Date()) {
  authorizePlatform(actor);
  await withSystem(async (tx) => {
    const edition = await loadForChange(tx, frameworkId);
    const blocker = retirementBlocker(edition);
    if (blocker) throw new DomainError<EditionError>(blocker);
    await repo.updateEdition(tx, frameworkId, { status: "retired", retiredAt: now });
    await recordPlatformAudit(tx, actor.userId, {
      action: "retire",
      entity: "framework",
      entityId: frameworkId,
      before: { status: "active" },
      after: { status: "retired" },
    });
  });
}

export async function deleteDraft(actor: PlatformActor, frameworkId: string) {
  authorizePlatform(actor);
  await withSystem(async (tx) => {
    const edition = await loadForChange(tx, frameworkId);
    const blocker = deletionBlocker(edition);
    if (blocker) throw new DomainError<EditionError>(blocker);
    await repo.deleteEdition(tx, frameworkId);
    await recordPlatformAudit(tx, actor.userId, {
      action: "delete",
      entity: "framework",
      entityId: frameworkId,
      before: { code: edition.code, edition: edition.edition, status: edition.status },
    });
  });
}

// --- Library (tenant side) -------------------------------------------------------------------

function authorizeMember(ctx: AccessContext) {
  // The library is the same for everyone, but it is part of the product: only people who
  // belong to a facility can read it.
  if (ctx.actor.memberships.length === 0) throw new ForbiddenError("standards.view");
}

/** The live editions, as the app role sees them (RLS hides drafts). */
export async function listLibrary(ctx: AccessContext) {
  authorizeMember(ctx);
  return withTenant(ctx, async (tx) =>
    withEsrCounts(tx, await repo.listEditions(tx, { status: "active" })),
  );
}

async function browse(tx: Tx, frameworkId: string, filter: BrowseFilter) {
  const edition = await repo.findEdition(tx, frameworkId);
  if (!edition) return null;
  const [content, departments] = await Promise.all([
    repo.findBrowseContent(tx, frameworkId),
    repo.listDepartmentTypes(tx),
  ]);
  const view = buildBrowseView(content, filter);
  return {
    edition,
    scale: content.scale,
    view,
    departments: departments.filter((d) => view.departmentCodes.includes(d.code)),
  };
}

export type LibraryBrowse = NonNullable<Awaited<ReturnType<typeof browse>>>;

/** One published edition (active or retired), filtered for the library screen. */
export async function browseLibrary(ctx: AccessContext, frameworkId: string, filter: BrowseFilter) {
  authorizeMember(ctx);
  if (!z.uuid().safeParse(frameworkId).success) return null;
  return withTenant(ctx, (tx) => browse(tx, frameworkId, filter));
}

/** Any edition, drafts included, so the admin can read a draft before putting it live. */
export async function browseEdition(
  actor: PlatformActor,
  frameworkId: string,
  filter: BrowseFilter,
) {
  authorizePlatform(actor);
  if (!z.uuid().safeParse(frameworkId).success) return null;
  return withSystem((tx) => browse(tx, frameworkId, filter));
}

// --- What applies to a facility (M5) ----------------------------------------------------------

/** The facility- and department-type catalogues, for forms. */
export async function listCatalogues(ctx: AccessContext) {
  authorizeMember(ctx);
  const [facilityTypes, departmentTypes] = await withTenant(ctx, (tx) => repo.loadCatalogues(tx));
  return { facilityTypes, departmentTypes };
}

/** The editions a facility is assessed against. Empty when the caller is not a member. */
export async function listFacilityFrameworks(ctx: AccessContext, facilityId: string) {
  if (!(await getFacility(ctx, facilityId))) return [];
  return withTenant(ctx, async (tx) =>
    (await repo.listFacilityFrameworks(tx, ctx.tenantId, facilityId)).map((f) => f.framework),
  );
}

/**
 * The live editions a facility can choose from, marking the ones it already uses and the
 * ones its type suggests. An edition it uses that has since been retired stays in the list,
 * so it is never dropped without the owner seeing it.
 */
export async function getFrameworkChoices(ctx: AccessContext, facilityId: string) {
  const facility = await getFacility(ctx, facilityId);
  if (!facility) return null;
  const suggested: readonly string[] = suggestedPrograms(facility.type);
  return withTenant(ctx, async (tx) => {
    const [active, chosen] = await Promise.all([
      repo.listEditions(tx, { status: "active" }),
      repo.listFacilityFrameworks(tx, ctx.tenantId, facilityId),
    ]);
    const chosenIds = new Set(chosen.map((c) => c.frameworkId));
    const retiredChosen = await repo.listEditions(tx, {
      id: { in: [...chosenIds].filter((id) => !active.some((a) => a.id === id)) },
    });
    const editions = await withEsrCounts(tx, [...active, ...retiredChosen]);
    return {
      facilityType: facility.type,
      // Nothing chosen yet: the form starts from the suggestion instead of an empty list.
      firstVisit: chosen.length === 0,
      choices: editions.map((e) => ({
        ...e,
        suggested: e.program !== null && suggested.includes(e.program),
        selected: chosenIds.has(e.id),
      })),
    };
  });
}

export type FrameworkChoices = NonNullable<Awaited<ReturnType<typeof getFrameworkChoices>>>;

const frameworkIdsSchema = z.array(z.uuid()).max(20);

/**
 * Sets which editions the facility is assessed against. Only live editions can be added;
 * one already in use may stay after it is retired, until the facility moves to the new one.
 */
export async function setFacilityFrameworks(
  ctx: AccessContext,
  facilityId: string,
  frameworkIds: string[],
) {
  if (!allowed(ctx, "facility.updateSettings", { facilityId })) {
    throw new ForbiddenError("facility.updateSettings");
  }
  const wanted = [...new Set(frameworkIdsSchema.parse(frameworkIds))];
  if (wanted.length === 0) throw new DomainError("noFrameworks");
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("facility.updateSettings");

  return withTenant(ctx, async (tx) => {
    const current = await repo.listFacilityFrameworks(tx, ctx.tenantId, facilityId);
    const currentIds = new Set(current.map((c) => c.frameworkId));
    const added = wanted.filter((id) => !currentIds.has(id));
    const removed = [...currentIds].filter((id) => !wanted.includes(id));
    if (added.length > 0) {
      const live = await repo.listEditions(tx, { id: { in: added }, status: "active" });
      if (live.length !== added.length) throw new DomainError("unknownFramework");
      // Two editions of one framework would score the same requirements twice.
      const codes = [
        ...current.filter((c) => !removed.includes(c.frameworkId)).map((c) => c.framework.code),
        ...live.map((l) => l.code),
      ];
      if (new Set(codes).size !== codes.length) throw new DomainError("duplicateFramework");
      await repo.insertFacilityFrameworks(tx, ctx.tenantId, facilityId, added, ctx.userId);
    }
    if (removed.length > 0) {
      await repo.deleteFacilityFrameworks(tx, ctx.tenantId, facilityId, removed);
    }
    if (added.length > 0 || removed.length > 0) {
      const label = (f: { code: string; edition: string }) => `${f.code} ${f.edition}`;
      const after = await repo.listFacilityFrameworks(tx, ctx.tenantId, facilityId);
      await recordAudit(tx, ctx, {
        action: "update",
        entity: "facility_frameworks",
        entityId: facilityId,
        before: current.map((c) => label(c.framework)),
        after: after.map((c) => label(c.framework)),
      });
    }
    return { added: added.length, removed: removed.length };
  });
}

/**
 * One chosen edition as it applies to the facility: the framework's facility-type rule,
 * then the facility's recorded decisions. Null when the facility is not the caller's or
 * does not use that edition.
 */
export async function getApplicability(
  ctx: AccessContext,
  facilityId: string,
  frameworkId: string,
  filter: ApplicabilityFilter = {},
) {
  if (!z.uuid().safeParse(frameworkId).success) return null;
  const facility = await getFacility(ctx, facilityId);
  if (!facility) return null;
  return withTenant(ctx, async (tx) => {
    const chosen = await repo.listFacilityFrameworks(tx, ctx.tenantId, facilityId);
    const framework = chosen.find((c) => c.frameworkId === frameworkId)?.framework;
    if (!framework) return null;
    const [content, overrides] = await Promise.all([
      repo.listApplicabilityElements(tx, frameworkId),
      repo.listApplicabilityOverrides(tx, ctx.tenantId, facilityId),
    ]);
    return {
      framework,
      facilityType: facility.type,
      chapters: content.chapters,
      view: buildApplicabilityView(content, facility.type, overrides, filter),
    };
  });
}

const decisionSchema = z.object({
  applicable: z.boolean(),
  justification: z.string().max(5000).nullable().default(null),
});

/**
 * Records whether one element applies to the facility. A decision equal to the framework's
 * own rule clears the override; ruling an element out needs a justification (domain rule).
 * ESR elements can be ruled out too, because some genuinely do not apply, but the screen
 * flags them.
 */
export async function decideApplicability(
  ctx: AccessContext,
  facilityId: string,
  elementId: string,
  input: z.input<typeof decisionSchema>,
  now = new Date(),
) {
  if (!allowed(ctx, "facility.updateSettings", { facilityId })) {
    throw new ForbiddenError("facility.updateSettings");
  }
  const decision = decisionSchema.parse(input);
  if (!z.uuid().safeParse(elementId).success) throw new DomainError("unknownElement");
  const facility = await getFacility(ctx, facilityId);
  if (!facility) throw new ForbiddenError("facility.updateSettings");

  return withTenant(ctx, async (tx) => {
    const element = await repo.findFacilityElement(tx, ctx.tenantId, facilityId, elementId);
    if (!element) throw new DomainError("unknownElement");
    const [existing] = await repo.listApplicabilityOverrides(tx, ctx.tenantId, facilityId, [
      elementId,
    ]);
    const byFramework =
      element.facilityTypes.length === 0 || element.facilityTypes.includes(facility.type);
    const change = applicabilityChange(byFramework, decision);
    if (change.kind === "invalid") throw new DomainError(change.problem);

    const before = existing
      ? { applicable: existing.applicable, justification: existing.justification }
      : null;
    if (change.kind === "clear") {
      if (existing) {
        await repo.deleteApplicability(tx, ctx.tenantId, facilityId, elementId);
        await recordAudit(tx, ctx, {
          action: "delete",
          entity: "element_applicability",
          entityId: elementId,
          before: { code: element.code, ...before },
        });
      }
      return { applicable: byFramework };
    }
    await repo.upsertApplicability(tx, ctx.tenantId, {
      facilityId,
      elementId,
      applicable: change.applicable,
      justification: change.justification,
      decidedBy: ctx.userId,
      decidedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: existing ? "update" : "create",
      entity: "element_applicability",
      entityId: elementId,
      before: before && { code: element.code, ...before },
      after: {
        code: element.code,
        isEsr: element.isEsr,
        applicable: change.applicable,
        justification: change.justification,
      },
    });
    return { applicable: change.applicable };
  });
}

/**
 * One chosen edition as the scoring engine needs it: the scale, the roll-up settings, and
 * every element with its weight and whether it applies to the facility (framework rule plus
 * the facility's own decision). Null when the facility is not the caller's or does not use
 * that edition. Numbers are plain numbers here so other modules never see Prisma decimals.
 */
export async function getScoringContent(
  ctx: AccessContext,
  facilityId: string,
  frameworkId: string,
) {
  if (!z.uuid().safeParse(frameworkId).success) return null;
  const facility = await getFacility(ctx, facilityId);
  if (!facility) return null;
  return withTenant(ctx, async (tx) => {
    const chosen = await repo.listFacilityFrameworks(tx, ctx.tenantId, facilityId);
    if (!chosen.some((c) => c.frameworkId === frameworkId)) return null;
    const [content, overrides] = await Promise.all([
      repo.listScoringContent(tx, frameworkId),
      repo.listApplicabilityOverrides(tx, ctx.tenantId, facilityId),
    ]);
    if (!content) return null;
    const byElement = new Map(overrides.map((o) => [o.elementId, o]));
    const config = rollupConfigSchema.parse(content.framework.rollupConfig);
    return {
      framework: {
        id: content.framework.id,
        code: content.framework.code,
        edition: content.framework.edition,
        nameAr: content.framework.nameAr,
        nameEn: content.framework.nameEn,
        status: content.framework.status,
      },
      rollupConfig: config,
      scale: content.scale.map((l) => ({
        id: l.id,
        code: l.code,
        labelAr: l.labelAr,
        labelEn: l.labelEn,
        value: Number(l.value),
        countsInDenominator: l.countsInDenominator,
        requiresEvidence: l.requiresEvidence,
        generatesFinding: l.generatesFinding,
      })),
      chapters: content.chapters,
      standards: content.standards.map((s) => ({ ...s, weight: Number(s.weight) })),
      elements: content.elements.map((e) => {
        const override = byElement.get(e.id);
        return {
          ...e,
          weight: Number(e.weight),
          applicable: resolveApplicability(e, facility.type, override ?? null).applicable,
        };
      }),
    };
  });
}
export type ScoringContent = NonNullable<Awaited<ReturnType<typeof getScoringContent>>>;

/** The elements of every edition the facility uses, for pickers (e.g. linking a document). */
export async function listFacilityElements(ctx: AccessContext, facilityId: string) {
  if (!(await getFacility(ctx, facilityId))) return [];
  return withTenant(ctx, (tx) => repo.listFacilityElements(tx, ctx.tenantId, facilityId));
}

/** One element, only if it belongs to an edition the facility uses. */
export async function getFacilityElement(
  ctx: AccessContext,
  facilityId: string,
  elementId: string,
) {
  if (!z.uuid().safeParse(elementId).success) return null;
  if (!(await getFacility(ctx, facilityId))) return null;
  return withTenant(ctx, (tx) => repo.findFacilityElement(tx, ctx.tenantId, facilityId, elementId));
}

// --- Seeding ------------------------------------------------------------------------------------

/**
 * Installs and activates an edition from a file in one step, for `pnpm db:seed` (fictional
 * DEMO-* content only). Goes through the same validation as an upload. Does nothing if the
 * edition already exists, so the seed can run repeatedly.
 */
export async function seedEdition(input: {
  fileName: string;
  bytes: Uint8Array;
  licenseNote: string;
}) {
  const read = await readImportFile({
    fileName: input.fileName,
    bytes: input.bytes,
    framework: {},
  });
  if (!read.workbook || hasErrors(read.issues))
    return { status: "invalid" as const, issues: read.issues };
  return withSystem(async (tx) => {
    const [facilityTypes, departmentTypes] = await repo.loadCatalogues(tx);
    const { document, issues } = validateWorkbook(read.workbook!, {
      facilityTypes: new Set(facilityTypes.map((t) => t.code)),
      departmentTypes: new Set(departmentTypes.map((t) => t.code)),
    });
    if (!document) return { status: "invalid" as const, issues };
    const { code, edition } = document.framework;
    if (await repo.editionExists(tx, code, edition)) return { status: "exists" as const };
    if (await repo.findActiveEdition(tx, code)) return { status: "exists" as const };

    const frameworkId = await repo.insertEdition(tx, document, null);
    const licenseNote = licenseNoteSchema.min(1).parse(input.licenseNote);
    await repo.updateEdition(tx, frameworkId, {
      licenseNote,
      status: "active",
      activatedAt: new Date(),
    });
    await recordPlatformAudit(tx, null, {
      action: "activate",
      entity: "framework",
      entityId: frameworkId,
      after: {
        code,
        edition,
        status: "active",
        source: "seed",
        elements: document.elements.length,
      },
    });
    return { status: "created" as const, frameworkId, elements: document.elements.length };
  });
}
