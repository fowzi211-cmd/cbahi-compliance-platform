import { randomUUID } from "node:crypto";
import { withSystem } from "@/lib/db";
import {
  activateEdition,
  commitImport,
  previewImport,
  setLicenseNote,
} from "@/modules/standards/service";
import {
  getAssessmentSheet,
  saveElementScore,
  startAssessment,
  submitAssessment,
} from "@/modules/assessments/service";
import { createDocument, decideVersion } from "@/modules/documents/service";
import { exportMockSurveyReport, startMockSurvey } from "@/modules/surveys/service";
import { addCapaEvidence, createCapaItem, listFindings } from "@/modules/findings/service";
import { toRiyadhDay } from "@/lib/dates";
import { makePdf } from "@/modules/documents/test-files";
import { createTenant, loadAccessContext, type AccessContext } from "@/modules/tenancy/service";

export async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const created = await createTenant({
    name: `${label} ${suffix}`,
    owner: { email: `owner-${suffix}@example.test`, name: `Owner ${label}` },
    facility: { nameAr: `منشأة ${label}`, nameEn: `Facility ${label}`, type: "polyclinic" },
  });
  const ctx = (await loadAccessContext(created.owner.id, created.tenant.id))!;
  return { ...created, ctx };
}

/**
 * A context whose permission layer has been fooled into thinking the caller also owns
 * `foreignFacilityId`. Used to prove that the database still refuses cross-tenant access
 * when `can()` is wrong.
 */
export function forgedContext(ctx: AccessContext, foreignFacilityId: string): AccessContext {
  return {
    ...ctx,
    actor: {
      ...ctx.actor,
      memberships: [
        ...ctx.actor.memberships,
        { facilityId: foreignFacilityId, departmentId: null, role: "facility_owner" },
      ],
    },
  };
}

export const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.test`;

/** A bare user row, as sign-up would create (without a password, which these tests skip). */
export function createUser(email: string, name = "Test user") {
  return withSystem((tx) => tx.user.create({ data: { email, name } }));
}

/** A unique, fictional framework code so tests sharing the global library never collide. */
export const uniqueFrameworkCode = () => `DEMO-T${randomUUID().slice(0, 8).toUpperCase()}`;

/** A small fictional edition in the JSON import format. Never real accreditation text. */
export function demoEditionJson(
  code: string,
  edition: string,
  options: {
    esr?: string[];
    elements?: string[];
    // Facility types per element number, e.g. { "3": "hospital" }.
    facilityTypes?: Record<string, string>;
    // Department types per element number; by default element 2 belongs to nursing.
    departmentTypes?: Record<string, string>;
    program?: string;
    rollupConfig?: object;
  } = {},
) {
  const elements = options.elements ?? ["1", "2", "3"];
  const esr = new Set(options.esr ?? ["1"]);
  return JSON.stringify({
    format: "mustamir.framework/v1",
    framework: {
      code,
      edition,
      name_ar: "إطار تجريبي",
      name_en: "Demo framework",
      program: options.program ?? "ambulatory",
      ...(options.rollupConfig ? { rollup_config: options.rollupConfig } : {}),
    },
    chapters: [{ code: "DEMO-X", title_ar: "فصل تجريبي", title_en: "Demo chapter" }],
    standards: [
      {
        code: "DEMO-X.1",
        chapter_code: "DEMO-X",
        title_ar: "معيار تجريبي",
        title_en: "Demo standard",
      },
    ],
    elements: elements.map((n) => ({
      code: `DEMO-X.1.${n}`,
      standard_code: "DEMO-X.1",
      title_ar: `عنصر تجريبي ${n}`,
      title_en: `Demo element ${n}`,
      is_esr: esr.has(n),
      department_types: options.departmentTypes
        ? (options.departmentTypes[n] ?? "")
        : n === "2"
          ? "nursing"
          : "",
      facility_types: options.facilityTypes?.[n] ?? "",
    })),
  });
}

/** Imports, licenses and activates a fictional edition, as the platform admin would. */
export async function publishDemoEdition(
  options: Parameters<typeof demoEditionJson>[2] & { program?: string } = {},
) {
  const adminUser = await createUser(uniqueEmail("library-admin"));
  const admin = { userId: adminUser.id, isPlatformAdmin: true };
  const code = uniqueFrameworkCode();
  const json = JSON.parse(demoEditionJson(code, "1", options)) as { framework: object };
  if (options.program) Object.assign(json.framework, { program: options.program });
  const preview = await previewImport(admin, {
    fileName: "e.json",
    bytes: new TextEncoder().encode(JSON.stringify(json)),
    framework: {},
  });
  if (!preview.ok) throw new Error(`fixture import failed: ${JSON.stringify(preview.issues)}`);
  const frameworkId = await commitImport(admin, preview.importId);
  await setLicenseNote(admin, frameworkId, "Fictional demo content.");
  await activateEdition(admin, frameworkId);
  return { frameworkId, code, admin };
}

/**
 * Runs a whole-facility self-assessment to the end: the first scorable element Partially Met
 * with an observation, every other one Not Met (or Met for ESR-free scales). Leaves an
 * assessment, scores, evidence, element statuses and findings behind.
 */
export async function submitDemoAssessment(
  ctx: AccessContext,
  facilityId: string,
  frameworkId: string,
) {
  const assessmentId = await startAssessment(ctx, facilityId, { frameworkId });
  const sheet = (await getAssessmentSheet(ctx, assessmentId))!;
  const elements = sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements));
  let evidenceId: string | null = null;
  for (const element of elements) {
    if (!evidenceId && !element.isEsr) {
      evidenceId = (
        await saveElementScore(ctx, assessmentId, element.id, {
          levelCode: "PM",
          comment: "Partly in place.",
          evidence: { kind: "observation", note: "Checklist seen, two gaps." },
        })
      ).evidenceId;
    } else {
      await saveElementScore(ctx, assessmentId, element.id, {
        levelCode: "NM",
        comment: "Not in place yet.",
      });
    }
  }
  await submitAssessment(ctx, assessmentId);
  return { assessmentId, evidenceId: evidenceId! };
}

/** Uploads and approves a fictional one-page policy; returns its ids. */
export async function approvedDemoDocument(
  ctx: AccessContext,
  facilityId: string,
  title = "Demo fridge policy",
) {
  const { documentId, versionId } = await createDocument(ctx, facilityId, {
    type: "policy",
    titleEn: title,
    file: { name: "policy.pdf", bytes: makePdf([title, `Revision ${randomUUID()}`]) },
    phiAttested: true,
  });
  await decideVersion(ctx, versionId, { decision: "approved" });
  return { documentId, versionId };
}

/**
 * A corrective action on the facility's first finding, owned by the caller, with one link as
 * evidence. Needs a submitted assessment that raised findings.
 */
export async function demoCapaItem(ctx: AccessContext, facilityId: string) {
  const [finding] = await listFindings(ctx, facilityId);
  if (!finding) throw new Error("fixture needs a finding");
  const { id: itemId } = await createCapaItem(ctx, finding.id, {
    action: "Retrain the team on the demo checklist.",
    ownerUserId: ctx.userId,
    dueOn: toRiyadhDay(new Date()),
  });
  const { id: evidenceId } = await addCapaEvidence(ctx, itemId, {
    kind: "link",
    url: "https://intranet.example.test/training-record",
  });
  return { findingId: finding.id, itemId, evidenceId };
}

/**
 * Runs a mock survey to the end as the caller (a consultant or the quality team): the ESR
 * element Not Met, the rest Met, each with an observation; locks it and issues its report.
 */
export async function submitDemoMockSurvey(
  ctx: AccessContext,
  facilityId: string,
  frameworkId: string,
) {
  const assessmentId = await startMockSurvey(ctx, facilityId, { frameworkId });
  const sheet = (await getAssessmentSheet(ctx, assessmentId))!;
  for (const element of sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements))) {
    await saveElementScore(ctx, assessmentId, element.id, {
      levelCode: element.isEsr ? "NM" : "MET",
      comment: element.isEsr ? "Not in place on the day." : "In place.",
      evidence: { kind: "observation", note: "Walked the clinic." },
    });
  }
  await submitAssessment(ctx, assessmentId);
  const reports = await exportMockSurveyReport(ctx, assessmentId, { phiAttested: true });
  return { assessmentId, reports };
}
