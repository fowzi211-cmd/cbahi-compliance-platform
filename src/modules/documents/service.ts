import { createHash } from "node:crypto";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { withTenant, type Tx } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { deleteObject, putObject, signedDownloadUrl, storageKey } from "@/lib/storage";
import { recordAudit } from "@/modules/audit/service";
import { getFacilityElement } from "@/modules/standards/service";
import {
  allowed,
  getFacility,
  isFacilityMember,
  listDepartments,
  type AccessContext,
} from "@/modules/tenancy/service";
import { contentTypes, detectFileKind, maxUploadBytes, scannableKinds } from "./domain/file-type";
import {
  approvalDecisions,
  decisionProblem,
  documentTypes,
  isCitable,
  versionDatesProblem,
  versionState,
  type VersionStatus,
} from "./domain/lifecycle";
import { scanForPhi, type PhiHit } from "./domain/phi-scan";
import { daysFrom as daysBetween, expiryWarningDays } from "./domain/reminders";
import { extractText } from "./extract-text";
import * as repo from "./repo";

export { documentTypes, approvalDecisions } from "./domain/lifecycle";
export type { DocumentType, VersionState, VersionStatus } from "./domain/lifecycle";
export { maxUploadBytes } from "./domain/file-type";
export type { PhiKind } from "./domain/phi-scan";

export type DocumentError =
  | "notFound"
  | "titleRequired"
  | "emptyFile"
  | "fileTooLarge"
  | "unsupportedFileType"
  | "phiAttestationRequired"
  | "phiDetected"
  | "duplicateFile"
  | "versionPending"
  | "documentRetired"
  | "unknownDepartment"
  | "unknownElement"
  | "reviewBeforeEffective"
  | "expiryBeforeEffective"
  | "expiryBeforeReview"
  | "notInReview"
  | "commentRequired";

// Calendar days travel as "YYYY-MM-DD" and are stored in DATE columns (midnight UTC).
const toDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const fromDay = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);
const optionalDay = z
  .union([z.iso.date(), z.literal("")])
  .nullish()
  .transform((value) => value || null);

const fileInput = z.object({
  name: z.string().trim().min(1).max(255),
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
});

const versionInput = z.object({
  file: fileInput,
  effectiveOn: optionalDay,
  reviewOn: optionalDay,
  expiresOn: optionalDay,
  changeNote: optionalText(1000),
  // The uploader's statement that the file holds no patient data. Required for every file.
  phiAttested: z.boolean(),
  // Set when the scan found something and the uploader confirms it is not patient data.
  phiConfirmed: z.boolean().default(false),
});
export type VersionInput = z.input<typeof versionInput>;

const documentInput = versionInput.extend({
  type: z.enum(documentTypes),
  titleAr: optionalText(300),
  titleEn: optionalText(300),
  departmentId: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((value) => value || null),
});
export type DocumentInput = z.input<typeof documentInput>;

/** Thrown when the scan found PHI patterns; carries the counts so the screen can say what. */
export class PhiDetectedError extends DomainError<"phiDetected"> {
  constructor(readonly hits: PhiHit[]) {
    super("phiDetected");
  }
}

type PreparedFile = {
  name: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: Uint8Array;
  phiScan: { scanned: boolean; hits: PhiHit[] };
  phiOverride: boolean;
};

/**
 * Everything that must hold before a file is stored: an attestation, an allowed type (from
 * the bytes), a size limit and the PHI scan. A file that fails never reaches storage.
 */
async function prepareFile(data: z.output<typeof versionInput>): Promise<PreparedFile> {
  if (!data.phiAttested) throw new DomainError<DocumentError>("phiAttestationRequired");
  const { bytes, name } = data.file;
  if (bytes.length === 0) throw new DomainError<DocumentError>("emptyFile");
  if (bytes.length > maxUploadBytes) throw new DomainError<DocumentError>("fileTooLarge");
  const kind = detectFileKind(bytes);
  if (!kind) throw new DomainError<DocumentError>("unsupportedFileType");
  const problem = versionDatesProblem(data);
  if (problem) throw new DomainError<DocumentError>(problem);

  const scannable = scannableKinds.includes(kind);
  const text = scannable ? await extractText(kind, bytes) : null;
  const hits = text === null ? [] : scanForPhi(text);
  if (hits.length > 0 && !data.phiConfirmed) throw new PhiDetectedError(hits);
  return {
    name,
    bytes,
    contentType: contentTypes[kind],
    sha256: createHash("sha256").update(bytes).digest(),
    phiScan: { scanned: text !== null, hits },
    phiOverride: hits.length > 0,
  };
}

function scopeOf(document: { facilityId: string; departmentId: string | null }) {
  return { facilityId: document.facilityId, departmentId: document.departmentId };
}

/**
 * Stores the file, then runs `write` in a transaction. If the transaction fails the file
 * is removed again, so storage never keeps a file the database does not know about.
 */
async function storeThen<T>(key: string, file: PreparedFile, write: () => Promise<T>) {
  await putObject(key, file.bytes, file.contentType);
  try {
    return await write();
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
}

async function auditUpload(
  tx: Tx,
  ctx: AccessContext,
  versionId: string,
  documentId: string,
  version: number,
  file: PreparedFile,
) {
  await recordAudit(tx, ctx, {
    action: "create",
    entity: "document_version",
    entityId: versionId,
    after: {
      documentId,
      version,
      fileName: file.name,
      contentType: file.contentType,
      bytes: file.bytes.length,
      sha256: Buffer.from(file.sha256).toString("hex"),
      phiScan: file.phiScan,
    },
  });
  if (file.phiOverride) {
    // The uploader went ahead although the scan matched: who and what kinds, never the text.
    await recordAudit(tx, ctx, {
      action: "accept",
      entity: "phi_override",
      entityId: versionId,
      after: { hits: file.phiScan.hits },
    });
  }
}

// --- Reading --------------------------------------------------------------------------------

export type DocumentSummary = Awaited<ReturnType<typeof listDocuments>>[number];

/** The facility's documents with the state of their latest approved and pending versions. */
export async function listDocuments(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!isFacilityMember(ctx, facilityId)) return [];
  const today = toRiyadhDay(now);
  const rows = await withTenant(ctx, (tx) => repo.listDocuments(tx, ctx.tenantId, facilityId));
  return rows.map(({ versions, _count, ...document }) => {
    const approved = versions.find((v) => v.status === "approved");
    const pending = versions.find((v) => v.status === "in_review");
    return {
      ...document,
      linkedElements: _count.elements,
      current: approved
        ? {
            version: approved.version,
            reviewOn: toDay(approved.reviewOn),
            expiresOn: toDay(approved.expiresOn),
            state: versionState(
              {
                ...approved,
                reviewOn: toDay(approved.reviewOn),
                expiresOn: toDay(approved.expiresOn),
              },
              today,
            ),
          }
        : null,
      pendingVersion: pending?.version ?? null,
    };
  });
}

/** One document with every version, its approvals and the elements it covers. */
export async function getDocument(ctx: AccessContext, documentId: string, now = new Date()) {
  if (!z.uuid().safeParse(documentId).success) return null;
  const row = await withTenant(ctx, (tx) => repo.findDocument(tx, ctx.tenantId, documentId));
  if (!row || !isFacilityMember(ctx, row.facilityId)) return null;
  const today = toRiyadhDay(now);
  const scope = scopeOf(row);
  return {
    ...row,
    elements: row.elements.map((e) => e.element),
    versions: row.versions.map((v) => {
      const dates = {
        effectiveOn: toDay(v.effectiveOn),
        reviewOn: toDay(v.reviewOn),
        expiresOn: toDay(v.expiresOn),
      };
      return { ...v, ...dates, state: versionState({ status: v.status, ...dates }, today) };
    }),
    canUpload: !row.retiredAt && allowed(ctx, "document.upload", scope),
    canApprove: !row.retiredAt && allowed(ctx, "document.approve", scope),
  };
}
export type DocumentDetail = NonNullable<Awaited<ReturnType<typeof getDocument>>>;

/**
 * A five-minute download link for one version, issued only to members of the document's
 * facility. Null when the version is not the caller's to see.
 */
export async function getDownloadUrl(ctx: AccessContext, versionId: string) {
  if (!z.uuid().safeParse(versionId).success) return null;
  const version = await withTenant(ctx, (tx) => repo.findVersion(tx, ctx.tenantId, versionId));
  if (!version || !isFacilityMember(ctx, version.document.facilityId)) return null;
  return signedDownloadUrl(version.storageKey, version.fileName, version.contentType);
}

// --- Uploading ------------------------------------------------------------------------------

/** What the caller may file a new document under: the whole facility and/or departments. */
export async function getUploadOptions(ctx: AccessContext, facilityId: string) {
  if (!isFacilityMember(ctx, facilityId)) return null;
  const departments = await listDepartments(ctx, facilityId);
  return {
    wholeFacility: allowed(ctx, "document.upload", { facilityId, departmentId: null }),
    departments: departments
      .filter((d) => allowed(ctx, "document.upload", { facilityId, departmentId: d.id }))
      .map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn })),
  };
}

/**
 * What another module may add when it files a document through its own record (a meeting's
 * minutes): elements to link at once, and a step that runs in the same transaction, so the
 * caller's row and the document are written together or not at all.
 */
export type DocumentFiling = {
  elementIds?: readonly string[];
  inTransaction?: (tx: Tx, created: { documentId: string; versionId: string }) => Promise<void>;
};

/** Creates a document with its first version, waiting for approval. */
export async function createDocument(
  ctx: AccessContext,
  facilityId: string,
  input: DocumentInput,
  now = new Date(),
  filing: DocumentFiling = {},
) {
  const data = documentInput.parse(input);
  const scope = { facilityId, departmentId: data.departmentId };
  if (!allowed(ctx, "document.upload", scope)) throw new ForbiddenError("document.upload");
  if (!(await getFacility(ctx, facilityId))) throw new ForbiddenError("document.upload");
  if (!data.titleAr && !data.titleEn) throw new DomainError<DocumentError>("titleRequired");
  if (
    data.departmentId &&
    !(await listDepartments(ctx, facilityId)).some((d) => d.id === data.departmentId)
  ) {
    throw new DomainError<DocumentError>("unknownDepartment");
  }
  const elements: { id: string; code: string }[] = [];
  for (const elementId of new Set(filing.elementIds ?? [])) {
    const element = await getFacilityElement(ctx, facilityId, elementId);
    if (!element) throw new DomainError<DocumentError>("unknownElement");
    elements.push(element);
  }
  const file = await prepareFile(data);
  const documentId = uuidv7();
  const versionId = uuidv7();
  const key = storageKey(ctx.tenantId, facilityId, "documents", documentId, versionId);

  await storeThen(key, file, () =>
    withTenant(ctx, async (tx) => {
      await repo.insertDocument(tx, ctx.tenantId, {
        id: documentId,
        facilityId,
        departmentId: data.departmentId,
        type: data.type,
        titleAr: data.titleAr,
        titleEn: data.titleEn,
        ownerUserId: ctx.userId,
      });
      await recordAudit(tx, ctx, {
        action: "create",
        entity: "document",
        entityId: documentId,
        after: {
          type: data.type,
          titleAr: data.titleAr,
          titleEn: data.titleEn,
          departmentId: data.departmentId,
        },
      });
      await repo.insertVersion(tx, ctx.tenantId, {
        id: versionId,
        documentId,
        version: 1,
        fileName: file.name,
        contentType: file.contentType,
        bytes: file.bytes.length,
        sha256: file.sha256,
        storageKey: key,
        effectiveOn: fromDay(data.effectiveOn),
        reviewOn: fromDay(data.reviewOn),
        expiresOn: fromDay(data.expiresOn),
        changeNote: data.changeNote,
        phiScan: file.phiScan,
        phiOverride: file.phiOverride,
        uploadedBy: ctx.userId,
        uploadedAt: now,
      });
      await auditUpload(tx, ctx, versionId, documentId, 1, file);
      for (const element of elements) {
        await repo.linkElement(tx, ctx.tenantId, {
          documentId,
          elementId: element.id,
          createdBy: ctx.userId,
        });
        await recordAudit(tx, ctx, {
          action: "link",
          entity: "document_element",
          entityId: documentId,
          after: { element: element.code },
        });
      }
      await filing.inTransaction?.(tx, { documentId, versionId });
    }),
  );
  return { documentId, versionId };
}

/**
 * Adds a new version, waiting for approval. The approved version stays in force until the
 * new one is approved. One version waits for review at a time, and the same file cannot be
 * uploaded twice to one document.
 */
export async function uploadVersion(
  ctx: AccessContext,
  documentId: string,
  input: VersionInput,
  now = new Date(),
) {
  const data = versionInput.parse(input);
  const document = await getDocument(ctx, documentId, now);
  if (!document) throw new DomainError<DocumentError>("notFound");
  if (!allowed(ctx, "document.upload", scopeOf(document))) {
    throw new ForbiddenError("document.upload");
  }
  if (document.retiredAt) throw new DomainError<DocumentError>("documentRetired");
  const file = await prepareFile(data);
  const versionId = uuidv7();
  const key = storageKey(ctx.tenantId, document.facilityId, "documents", documentId, versionId);

  return storeThen(key, file, () =>
    withTenant(ctx, async (tx) => {
      await repo.lockDocument(tx, ctx.tenantId, documentId);
      const existing = await repo.listVersionHashes(tx, ctx.tenantId, documentId);
      if (existing.some((v) => v.status === "in_review")) {
        throw new DomainError<DocumentError>("versionPending");
      }
      const hash = Buffer.from(file.sha256);
      if (existing.some((v) => hash.equals(Buffer.from(v.sha256)))) {
        throw new DomainError<DocumentError>("duplicateFile");
      }
      const version = Math.max(0, ...existing.map((v) => v.version)) + 1;
      await repo.insertVersion(tx, ctx.tenantId, {
        id: versionId,
        documentId,
        version,
        fileName: file.name,
        contentType: file.contentType,
        bytes: file.bytes.length,
        sha256: file.sha256,
        storageKey: key,
        effectiveOn: fromDay(data.effectiveOn),
        reviewOn: fromDay(data.reviewOn),
        expiresOn: fromDay(data.expiresOn),
        changeNote: data.changeNote,
        phiScan: file.phiScan,
        phiOverride: file.phiOverride,
        uploadedBy: ctx.userId,
        uploadedAt: now,
      });
      await auditUpload(tx, ctx, versionId, documentId, version, file);
      return { versionId, version };
    }),
  );
}

// --- Approval, retirement, links ------------------------------------------------------------

const decisionInput = z.object({
  decision: z.enum(approvalDecisions),
  comment: optionalText(2000),
});

/**
 * Approves or rejects the version waiting for review. Approving puts it in force and marks
 * the previously approved version superseded, in one transaction.
 */
export async function decideVersion(
  ctx: AccessContext,
  versionId: string,
  input: z.input<typeof decisionInput>,
  now = new Date(),
) {
  const data = decisionInput.parse(input);
  if (!z.uuid().safeParse(versionId).success) throw new DomainError<DocumentError>("notFound");
  return withTenant(ctx, async (tx) => {
    const version = await repo.findVersion(tx, ctx.tenantId, versionId);
    if (!version || !isFacilityMember(ctx, version.document.facilityId)) {
      throw new DomainError<DocumentError>("notFound");
    }
    if (!allowed(ctx, "document.approve", scopeOf(version.document))) {
      throw new ForbiddenError("document.approve");
    }
    if (version.document.retiredAt) throw new DomainError<DocumentError>("documentRetired");
    await repo.lockDocument(tx, ctx.tenantId, version.documentId);
    const problem = decisionProblem(version.status, data.decision, data.comment);
    if (problem) throw new DomainError<DocumentError>(problem);

    const to: VersionStatus = data.decision;
    const { count } = await repo.setVersionStatus(tx, ctx.tenantId, versionId, "in_review", to);
    if (count === 0) throw new DomainError<DocumentError>("notInReview");
    const superseded =
      to === "approved"
        ? (await repo.supersedeOthers(tx, ctx.tenantId, version.documentId, versionId)).count
        : 0;
    await repo.insertApproval(tx, ctx.tenantId, {
      versionId,
      approverUserId: ctx.userId,
      decision: data.decision,
      comment: data.comment,
      decidedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: data.decision === "approved" ? "approve" : "reject",
      entity: "document_version",
      entityId: versionId,
      before: { status: "in_review" },
      after: {
        status: to,
        documentId: version.documentId,
        version: version.version,
        comment: data.comment,
        // Recorded so a reviewer can see when an author approved their own file.
        selfApproved: version.uploadedBy === ctx.userId,
        superseded,
      },
    });
    return { status: to };
  });
}

/** Takes a document out of use. Its versions stay on record; it can no longer be cited. */
export async function retireDocument(ctx: AccessContext, documentId: string, now = new Date()) {
  const document = await getDocument(ctx, documentId, now);
  if (!document) throw new DomainError<DocumentError>("notFound");
  if (!allowed(ctx, "document.approve", scopeOf(document))) {
    throw new ForbiddenError("document.approve");
  }
  return withTenant(ctx, async (tx) => {
    const { count } = await repo.retireDocument(tx, ctx.tenantId, documentId, now);
    if (count === 0) throw new DomainError<DocumentError>("documentRetired");
    await recordAudit(tx, ctx, { action: "retire", entity: "document", entityId: documentId });
  });
}

/** Records that the document covers an element of an edition the facility uses. */
export async function setElementLink(
  ctx: AccessContext,
  documentId: string,
  elementId: string,
  linked: boolean,
) {
  const document = await getDocument(ctx, documentId);
  if (!document) throw new DomainError<DocumentError>("notFound");
  if (!allowed(ctx, "document.upload", scopeOf(document))) {
    throw new ForbiddenError("document.upload");
  }
  const element = await getFacilityElement(ctx, document.facilityId, elementId);
  if (!element) throw new DomainError<DocumentError>("unknownElement");
  return withTenant(ctx, async (tx) => {
    if (linked) {
      await repo.linkElement(tx, ctx.tenantId, { documentId, elementId, createdBy: ctx.userId });
    } else if ((await repo.unlinkElement(tx, ctx.tenantId, documentId, elementId)).count === 0) {
      return;
    }
    await recordAudit(tx, ctx, {
      action: linked ? "link" : "unlink",
      entity: "document_element",
      entityId: documentId,
      after: { element: element.code },
    });
  });
}

// --- Citing as evidence ---------------------------------------------------------------------

export type CitableVersion = {
  versionId: string;
  documentId: string;
  version: number;
  titleAr: string | null;
  titleEn: string | null;
  elementIds: string[];
};

/**
 * The approved versions in force in a facility, which a score may cite (rule 8). Documents
 * linked to an element are what a scorer will usually want first.
 */
export async function listCitableVersions(
  ctx: AccessContext,
  facilityId: string,
  now = new Date(),
): Promise<CitableVersion[]> {
  if (!isFacilityMember(ctx, facilityId)) return [];
  const today = toRiyadhDay(now);
  const rows = await withTenant(ctx, (tx) =>
    repo.listApprovedVersions(tx, ctx.tenantId, facilityId),
  );
  return rows
    .filter((v) =>
      isCitable(
        { status: v.status, reviewOn: toDay(v.reviewOn), expiresOn: toDay(v.expiresOn) },
        v.document.retiredAt !== null,
        today,
      ),
    )
    .map((v) => ({
      versionId: v.id,
      documentId: v.document.id,
      version: v.version,
      titleAr: v.document.titleAr,
      titleEn: v.document.titleEn,
      elementIds: v.document.elements.map((e) => e.elementId),
    }));
}

/**
 * Approved documents that need attention on the dashboard: in force but expiring within the
 * warning window, already expired (no longer citable), or due for review. Soonest first.
 */
export async function getDocumentAlerts(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!isFacilityMember(ctx, facilityId)) return { expiring: [], expired: [], reviewDue: 0 };
  const today = toRiyadhDay(now);
  const rows = await withTenant(ctx, (tx) =>
    repo.listApprovedVersions(tx, ctx.tenantId, facilityId),
  );
  const expiring = [];
  const expired = [];
  let reviewDue = 0;
  for (const v of rows) {
    const dates = { reviewOn: toDay(v.reviewOn), expiresOn: toDay(v.expiresOn) };
    const state = versionState({ status: v.status, ...dates }, today);
    const item = {
      documentId: v.document.id,
      versionId: v.id,
      version: v.version,
      titleAr: v.document.titleAr,
      titleEn: v.document.titleEn,
      expiresOn: dates.expiresOn!,
    };
    if (state === "expired") expired.push(item);
    else if (dates.expiresOn && daysBetween(today, dates.expiresOn) <= expiryWarningDays) {
      expiring.push(item);
    }
    if (state === "reviewDue") reviewDue += 1;
  }
  const byDate = (a: { expiresOn: string }, b: { expiresOn: string }) =>
    a.expiresOn.localeCompare(b.expiresOn);
  return { expiring: expiring.sort(byDate), expired: expired.sort(byDate), reviewDue };
}
export type DocumentAlerts = Awaited<ReturnType<typeof getDocumentAlerts>>;

/** One citable version of the facility, or null (not approved, expired, retired, elsewhere). */
export async function findCitableVersion(
  ctx: AccessContext,
  facilityId: string,
  versionId: string,
  now = new Date(),
) {
  if (!z.uuid().safeParse(versionId).success) return null;
  return (
    (await listCitableVersions(ctx, facilityId, now)).find((v) => v.versionId === versionId) ?? null
  );
}
