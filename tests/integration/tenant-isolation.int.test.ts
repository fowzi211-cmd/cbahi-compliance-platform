import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withoutTenant, withTenant } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  getAssessmentSheet,
  getReadiness,
  getStartOptions,
  listAssessments,
  removeEvidence,
  saveElementScore,
  startAssessment,
  submitAssessment,
} from "@/modules/assessments/service";
import { listAuditEvents } from "@/modules/audit/service";
import {
  createDocument,
  decideVersion,
  getDocument,
  getDownloadUrl,
  listCitableVersions,
  listDocuments,
  retireDocument,
  setElementLink,
  uploadVersion,
} from "@/modules/documents/service";
import { makePdf } from "@/modules/documents/test-files";
import {
  addCapaEvidence,
  countOverdueCapa,
  createCapaItem,
  getFinding,
  listCapaOwners,
  listFindings,
  listMyCapaItems,
  removeCapaEvidence,
  rescheduleCapaItem,
  transitionCapaItem,
} from "@/modules/findings/service";
import {
  activateEdition,
  browseLibrary,
  commitImport,
  decideApplicability,
  getApplicability,
  getFrameworkChoices,
  listFacilityFrameworks,
  listLibrary,
  previewImport,
  setFacilityFrameworks,
  setLicenseNote,
} from "@/modules/standards/service";
import { getSurveyCycle, saveSurveyCycle } from "@/modules/surveys/service";
import {
  acceptInvitation,
  addMembership,
  archiveDepartment,
  completeOnboardingStep,
  createDepartment,
  getFacility,
  getOnboardingProgress,
  getSubscription,
  inviteMember,
  listDepartments,
  listFacilities,
  listMemberships,
  listOpenInvitations,
  listUserMemberships,
  renameFacility,
  revokeInvitation,
  updateFacilityProfile,
  type AccessContext,
} from "@/modules/tenancy/service";
import {
  approvedDemoDocument,
  createUser,
  demoCapaItem,
  demoEditionJson,
  forgedContext,
  makeTenant,
  publishDemoEdition,
  submitDemoAssessment,
  uniqueEmail,
  uniqueFrameworkCode,
} from "./helpers";

// Two tenants side by side. Every read and write made as tenant A must be blind to tenant B
// at three layers: the permission check, the services with a fooled permission check
// (`aForged`), and raw SQL (the RLS layer on its own).
let a: Awaited<ReturnType<typeof makeTenant>>;
let b: Awaited<ReturnType<typeof makeTenant>>;
let aForged: AccessContext;
let bDepartmentId: string;
let bInvitationId: string;
let sharedFrameworkId: string;
let bElementId: string;
let bAssessment: { assessmentId: string; evidenceId: string };
let bOpenAssessmentId: string;
let bDocument: { documentId: string; versionId: string };
let bPendingVersionId: string;
let bCapa: { findingId: string; itemId: string; evidenceId: string };

beforeAll(async () => {
  [a, b] = await Promise.all([makeTenant("A"), makeTenant("B")]);
  await createDepartment(a.ctx, {
    facilityId: a.facility.id,
    nameAr: "استقبال",
    nameEn: "Reception",
  });
  bDepartmentId = (
    await createDepartment(b.ctx, { facilityId: b.facility.id, nameAr: "مختبر", nameEn: "Lab" })
  ).id;
  await inviteMember(a.ctx, {
    facilityId: a.facility.id,
    email: uniqueEmail("a-staff"),
    role: "staff",
  });
  bInvitationId = (
    await inviteMember(b.ctx, {
      facilityId: b.facility.id,
      email: uniqueEmail("b-staff"),
      role: "staff",
    })
  ).invitation.id;
  aForged = forgedContext(a.ctx, b.facility.id);

  // Onboarding rows in both tenants, against the same (global) edition.
  sharedFrameworkId = (await publishDemoEdition()).frameworkId;
  await Promise.all(
    [a, b].map((t) => setFacilityFrameworks(t.ctx, t.facility.id, [sharedFrameworkId])),
  );
  const bView = (await getApplicability(b.ctx, b.facility.id, sharedFrameworkId))!;
  bElementId = bView.view.groups[0]!.elements[0]!.id;
  for (const t of [a, b]) {
    await decideApplicability(t.ctx, t.facility.id, bElementId, {
      applicable: false,
      justification: `Not provided at facility ${t === a ? "A" : "B"}.`,
    });
    await saveSurveyCycle(t.ctx, t.facility.id, { status: "never_surveyed" });
    await completeOnboardingStep(t.ctx, t.facility.id, "facility");
  }

  // A submitted self-assessment in each tenant (scores, evidence, statuses, findings), and an
  // open one in B to try writing into.
  await submitDemoAssessment(a.ctx, a.facility.id, sharedFrameworkId);
  bAssessment = await submitDemoAssessment(b.ctx, b.facility.id, sharedFrameworkId);
  bOpenAssessmentId = await startAssessment(b.ctx, b.facility.id, {
    frameworkId: sharedFrameworkId,
  });

  // An approved, linked document in each tenant, and a version waiting for review in B.
  await approvedDemoDocument(a.ctx, a.facility.id).then(({ documentId }) =>
    setElementLink(a.ctx, documentId, bElementId, true),
  );
  bDocument = await approvedDemoDocument(b.ctx, b.facility.id);
  await setElementLink(b.ctx, bDocument.documentId, bElementId, true);
  bPendingVersionId = (
    await uploadVersion(b.ctx, bDocument.documentId, {
      file: { name: "v2.pdf", bytes: makePdf(["B second issue", randomUUID()]) },
      phiAttested: true,
    })
  ).versionId;

  // A corrective action with evidence in each tenant.
  await demoCapaItem(a.ctx, a.facility.id);
  bCapa = await demoCapaItem(b.ctx, b.facility.id);
});

afterAll(disconnectDb);

describe("permission layer", () => {
  it("refuses to act on a facility the caller holds no role in", async () => {
    await expect(
      renameFacility(a.ctx, b.facility.id, { nameAr: "x", nameEn: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inviteMember(a.ctx, { facilityId: b.facility.id, email: uniqueEmail("x"), role: "staff" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getFacility(a.ctx, b.facility.id)).toBeNull();
  });
});

describe("service layer with a fooled permission check", () => {
  it("lists only the caller's facilities", async () => {
    const facilities = await listFacilities(a.ctx);
    expect(facilities.map((f) => f.id)).toEqual([a.facility.id]);
  });

  it("cannot read another tenant's facility by id", async () => {
    expect(await getFacility(aForged, b.facility.id)).toBeNull();
  });

  it("cannot update another tenant's facility", async () => {
    expect(
      await renameFacility(aForged, b.facility.id, { nameAr: "اختراق", nameEn: "Hijack" }),
    ).toBe(false);
    expect((await getFacility(b.ctx, b.facility.id))?.nameEn).toBe("Facility B");
  });

  it("cannot list another tenant's departments or memberships", async () => {
    expect(await listDepartments(aForged, b.facility.id)).toEqual([]);
    expect(await listMemberships(aForged, b.facility.id)).toEqual([]);
  });

  it("cannot attach a department to another tenant's facility", async () => {
    await expect(
      createDepartment(aForged, { facilityId: b.facility.id, nameAr: "x", nameEn: "x" }),
    ).rejects.toThrow();
  });

  it("cannot grant a membership in another tenant's facility or department", async () => {
    await expect(
      addMembership(aForged, { userId: a.owner.id, facilityId: b.facility.id, role: "viewer" }),
    ).rejects.toThrow();
    await expect(
      addMembership(a.ctx, {
        userId: a.owner.id,
        facilityId: a.facility.id,
        departmentId: bDepartmentId,
        role: "department_head",
      }),
    ).rejects.toThrow();
  });

  it("cannot list, revoke or create invitations in another tenant", async () => {
    expect(await listOpenInvitations(aForged, b.facility.id)).toEqual([]);
    expect(await revokeInvitation(aForged, bInvitationId)).toBe(false);
    await expect(
      inviteMember(aForged, {
        facilityId: b.facility.id,
        email: uniqueEmail("x"),
        role: "staff",
      }),
    ).rejects.toThrow();
  });

  it("cannot read or change another tenant's onboarding", async () => {
    expect(await getFrameworkChoices(aForged, b.facility.id)).toBeNull();
    expect(await listFacilityFrameworks(aForged, b.facility.id)).toEqual([]);
    expect(await getApplicability(aForged, b.facility.id, sharedFrameworkId)).toBeNull();
    expect(await getSurveyCycle(aForged, b.facility.id)).toBeNull();
    expect(await getOnboardingProgress(aForged, b.facility.id)).toBeNull();
    expect(
      await updateFacilityProfile(aForged, b.facility.id, {
        nameAr: "اختراق",
        nameEn: "Hijack",
        type: "hospital",
      }),
    ).toBe(false);
    expect(await completeOnboardingStep(aForged, b.facility.id, "people")).toBeNull();
    expect(await archiveDepartment(aForged, bDepartmentId)).toBe(false);
    await expect(
      setFacilityFrameworks(aForged, b.facility.id, [sharedFrameworkId]),
    ).rejects.toThrow();
    await expect(
      decideApplicability(aForged, b.facility.id, bElementId, {
        applicable: true,
        justification: null,
      }),
    ).rejects.toThrow();
    await expect(
      saveSurveyCycle(aForged, b.facility.id, { status: "never_surveyed" }),
    ).rejects.toThrow();

    // B's own view is untouched.
    expect((await getFacility(b.ctx, b.facility.id))?.type).toBe("polyclinic");
    expect((await getOnboardingProgress(b.ctx, b.facility.id))?.done).toEqual(["facility"]);
    const bView = (await getApplicability(b.ctx, b.facility.id, sharedFrameworkId))!;
    expect(bView.view.counts.notApplicable).toBe(1);
  });

  it("cannot read or change another tenant's assessments and findings", async () => {
    const bSheet = (await getAssessmentSheet(b.ctx, bOpenAssessmentId))!;
    const bElement = bSheet.chapters[0]!.standards[0]!.elements.find((e) => !e.isEsr)!;
    expect(await listAssessments(aForged, b.facility.id)).toEqual([]);
    expect(await getStartOptions(aForged, b.facility.id)).toBeNull();
    expect(await getAssessmentSheet(aForged, bAssessment.assessmentId)).toBeNull();
    expect(await getAssessmentSheet(aForged, bOpenAssessmentId)).toBeNull();
    expect(await listFindings(aForged, b.facility.id)).toEqual([]);
    expect(await getReadiness(aForged, b.facility.id)).toEqual([]);
    await expect(
      startAssessment(aForged, b.facility.id, { frameworkId: sharedFrameworkId }),
    ).rejects.toThrow();
    await expect(
      saveElementScore(aForged, bOpenAssessmentId, bElement.id, {
        levelCode: "NM",
        comment: "hijack",
      }),
    ).rejects.toThrow();
    await expect(removeEvidence(aForged, bAssessment.evidenceId)).rejects.toThrow();
    await expect(submitAssessment(aForged, bOpenAssessmentId)).rejects.toThrow();

    // B's own records are untouched.
    expect((await getAssessmentSheet(b.ctx, bOpenAssessmentId))?.progress.scored).toBe(0);
    expect(await listFindings(b.ctx, b.facility.id)).toHaveLength(2);
    expect(await listAssessments(b.ctx, b.facility.id)).toHaveLength(2);
  });

  it("cannot read, download or change another tenant's documents", async () => {
    expect(await listDocuments(aForged, b.facility.id)).toEqual([]);
    expect(await getDocument(aForged, bDocument.documentId)).toBeNull();
    // ROADMAP M8: a signed URL is never issued across tenants.
    expect(await getDownloadUrl(aForged, bDocument.versionId)).toBeNull();
    expect(await getDownloadUrl(a.ctx, bDocument.versionId)).toBeNull();
    expect(await listCitableVersions(aForged, b.facility.id)).toEqual([]);
    const file = { name: "x.pdf", bytes: makePdf(["hijack", randomUUID()]) };
    await expect(
      createDocument(aForged, b.facility.id, {
        type: "policy",
        titleEn: "x",
        file,
        phiAttested: true,
      }),
    ).rejects.toThrow();
    await expect(
      uploadVersion(aForged, bDocument.documentId, { file, phiAttested: true }),
    ).rejects.toThrow();
    await expect(
      decideVersion(aForged, bPendingVersionId, { decision: "approved" }),
    ).rejects.toThrow();
    await expect(
      setElementLink(aForged, bDocument.documentId, bElementId, false),
    ).rejects.toThrow();
    await expect(retireDocument(aForged, bDocument.documentId)).rejects.toThrow();
    await expect(
      saveElementScore(aForged, bOpenAssessmentId, bElementId, {
        levelCode: "MET",
        evidence: { kind: "document", documentVersionId: bDocument.versionId },
      }),
    ).rejects.toThrow();

    // B's document is untouched.
    const bView = (await getDocument(b.ctx, bDocument.documentId))!;
    expect(bView.retiredAt).toBeNull();
    expect(bView.versions.map((v) => v.status)).toEqual(["in_review", "approved"]);
    expect(bView.elements).toHaveLength(1);
    expect(await getDownloadUrl(b.ctx, bDocument.versionId)).toMatch(/^memory:\/\/tenants\//);
  });

  it("cannot cite another tenant's approved document in its own score", async () => {
    const own = await startAssessment(a.ctx, a.facility.id, { frameworkId: sharedFrameworkId });
    const sheet = (await getAssessmentSheet(a.ctx, own))!;
    const element = sheet.chapters[0]!.standards[0]!.elements.find((e) => !e.isEsr)!;
    await expect(
      saveElementScore(a.ctx, own, element.id, {
        levelCode: "MET",
        evidence: { kind: "document", documentVersionId: bDocument.versionId },
      }),
    ).rejects.toThrow(/documentNotCitable/);
  });

  it("cannot read or change another tenant's corrective actions", async () => {
    expect(await getFinding(aForged, bCapa.findingId)).toBeNull();
    expect(await getFinding(a.ctx, bCapa.findingId)).toBeNull();
    expect(await listMyCapaItems(aForged, b.facility.id)).toEqual([]);
    expect(await listCapaOwners(aForged, b.facility.id)).toEqual([]);
    expect(await countOverdueCapa(aForged, b.facility.id, new Date(Date.now() + 30 * 864e5))).toBe(
      0,
    );
    const dueOn = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await expect(
      createCapaItem(aForged, bCapa.findingId, {
        action: "hijack",
        ownerUserId: a.ctx.userId,
        dueOn,
      }),
    ).rejects.toThrow(/notFound/);
    await expect(
      transitionCapaItem(aForged, bCapa.itemId, { transition: "cancel", note: "hijack" }),
    ).rejects.toThrow(/notFound/);
    await expect(
      rescheduleCapaItem(aForged, bCapa.itemId, { dueOn, reason: "hijack" }),
    ).rejects.toThrow(/notFound/);
    await expect(
      addCapaEvidence(aForged, bCapa.itemId, { kind: "link", url: "https://x.example.test" }),
    ).rejects.toThrow(/notFound/);
    await expect(removeCapaEvidence(aForged, bCapa.evidenceId)).rejects.toThrow(/notFound/);

    // Nor cite B's approved document as closure evidence for its own action.
    const own = await demoCapaItem(a.ctx, a.facility.id);
    await expect(
      addCapaEvidence(a.ctx, own.itemId, {
        kind: "document",
        documentVersionId: bDocument.versionId,
      }),
    ).rejects.toThrow(/documentNotCitable/);

    // B's action is untouched.
    const bView = (await getFinding(b.ctx, bCapa.findingId))!;
    expect(bView.capaItems.map((i) => [i.status, i.evidence.length])).toEqual([["open", 1]]);
  });

  it("sees only its own subscription and audit trail", async () => {
    expect((await getSubscription(a.ctx))?.tenantId).toBe(a.tenant.id);
    const events = await listAuditEvents(a.ctx);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.tenantId === a.tenant.id)).toBe(true);
  });
});

describe("database layer (RLS) on its own", () => {
  const tenantColumn: Record<string, string> = {
    tenant: "id",
    subscription: "tenant_id",
    facility: "tenant_id",
    department: "tenant_id",
    membership: "tenant_id",
    invitation: "tenant_id",
    audit_event: "tenant_id",
    facility_framework: "tenant_id",
    element_applicability: "tenant_id",
    survey_cycle: "tenant_id",
    assessment: "tenant_id",
    element_score: "tenant_id",
    score_evidence: "tenant_id",
    element_status: "tenant_id",
    finding: "tenant_id",
    document: "tenant_id",
    document_version: "tenant_id",
    document_approval: "tenant_id",
    document_element: "tenant_id",
    capa_item: "tenant_id",
    capa_evidence: "tenant_id",
  };

  it.each(Object.entries(tenantColumn))(
    "raw SQL on %s cannot see another tenant's rows",
    async (table, column) => {
      const [visible] = await withTenant(a.ctx, (tx) =>
        tx.$queryRawUnsafe<{ own: number; other: number }[]>(
          `SELECT count(*) FILTER (WHERE ${column} = $1::uuid)::int AS own,
                  count(*) FILTER (WHERE ${column} = $2::uuid)::int AS other
           FROM ${table}`,
          a.tenant.id,
          b.tenant.id,
        ),
      );
      expect(visible.own).toBeGreaterThan(0);
      expect(visible.other).toBe(0);
    },
  );

  it("shows other tenants' users only through a shared membership", async () => {
    const emails = await withTenant(
      a.ctx,
      (tx) => tx.$queryRaw<{ email: string }[]>`SELECT email FROM app_user`,
    );
    expect(emails.map((row) => row.email)).toEqual([a.owner.email]);
  });

  it("rejects inserting a row tagged with another tenant", async () => {
    await expect(
      withTenant(
        a.ctx,
        (tx) =>
          tx.$executeRaw`INSERT INTO facility (id, tenant_id, name_ar, name_en, type, updated_at)
          VALUES (${randomUUID()}::uuid, ${b.tenant.id}::uuid, 'x', 'x', 'polyclinic', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects moving a row to another tenant", async () => {
    await expect(
      withTenant(
        a.ctx,
        (tx) =>
          tx.$executeRaw`UPDATE facility SET tenant_id = ${b.tenant.id}::uuid WHERE id = ${a.facility.id}::uuid`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let the app change its own tier", async () => {
    await expect(
      withTenant(a.ctx, (tx) => tx.$executeRaw`UPDATE subscription SET tier = 'hybrid'`),
    ).rejects.toThrow(/permission denied/);
  });

  it("sees nothing when no tenant is set (fails closed)", async () => {
    const rows = await withTenant(a.ctx, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
      return tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM facility`;
    });
    expect(rows[0].n).toBe(0);
  });

  it("does not leak the tenant setting to the next transaction on a pooled connection", async () => {
    await withTenant(a.ctx, async () => undefined);
    const rows = await withTenant(
      b.ctx,
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM facility`,
    );
    expect(rows.map((row) => row.id)).toEqual([b.facility.id]);
  });

  it("keeps the app role away from password hashes, sessions and TOTP secrets", async () => {
    for (const table of ["auth_account", "auth_session", "auth_two_factor", "auth_verification"]) {
      await expect(
        withTenant(a.ctx, (tx) => tx.$queryRawUnsafe(`SELECT 1 FROM ${table} LIMIT 1`)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("without a tenant, sees no tenant rows except through the narrow lookups", async () => {
    const rows = await withoutTenant(
      (tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM membership`,
    );
    expect(rows[0]!.n).toBe(0);
    const mine = await listUserMemberships(a.owner.id);
    expect(mine.map((m) => m.tenantId)).toEqual([a.tenant.id]);
  });
});

describe("invitations across tenants", () => {
  it("joins only the tenant the invitation belongs to", async () => {
    const email = uniqueEmail("joiner");
    const { token } = await inviteMember(b.ctx, {
      facilityId: b.facility.id,
      email,
      role: "viewer",
    });
    const joiner = await createUser(email);
    await acceptInvitation(token, joiner);
    expect((await listUserMemberships(joiner.id)).map((m) => m.tenantId)).toEqual([b.tenant.id]);
    const aMembers = await listMemberships(a.ctx, a.facility.id);
    expect(aMembers.some((m) => m.userId === joiner.id)).toBe(false);
  });
});

// The standards library is global, not tenant-owned: every tenant reads the same published
// editions. What must hold is that the app role can only read it, and never sees drafts
// (their licence is not confirmed) or the import staging table.
describe("standards library", () => {
  let draftId: string;
  let liveId: string;

  beforeAll(async () => {
    const adminUser = await createUser(uniqueEmail("library-admin"));
    const admin = { userId: adminUser.id, isPlatformAdmin: true };
    const code = uniqueFrameworkCode();
    const commit = async (edition: string) => {
      const preview = await previewImport(admin, {
        fileName: "e.json",
        bytes: new TextEncoder().encode(demoEditionJson(code, edition)),
        framework: {},
      });
      if (!preview.ok) throw new Error("fixture import failed");
      return commitImport(admin, preview.importId);
    };
    liveId = await commit("1");
    await setLicenseNote(admin, liveId, "Fictional demo content.");
    await activateEdition(admin, liveId);
    draftId = await commit("2");
  });

  it("shows both tenants the same published editions and neither the drafts", async () => {
    const [seenByA, seenByB] = await Promise.all([listLibrary(a.ctx), listLibrary(b.ctx)]);
    expect(seenByA.map((f) => f.id)).toEqual(seenByB.map((f) => f.id));
    expect(seenByA.some((f) => f.id === liveId)).toBe(true);
    expect(seenByA.some((f) => f.id === draftId)).toBe(false);
    expect(await browseLibrary(aForged, draftId, {})).toBeNull();
  });

  it.each(["framework", "score_level", "chapter", "standard", "element"])(
    "raw SQL on %s cannot see draft rows",
    async (table) => {
      const column = table === "framework" ? "id" : "framework_id";
      const [counts] = await withTenant(a.ctx, (tx) =>
        tx.$queryRawUnsafe<{ live: number; draft: number }[]>(
          `SELECT count(*) FILTER (WHERE ${column} = $1::uuid)::int AS live,
                  count(*) FILTER (WHERE ${column} = $2::uuid)::int AS draft
           FROM ${table}`,
          liveId,
          draftId,
        ),
      );
      expect(counts.live).toBeGreaterThan(0);
      expect(counts.draft).toBe(0);
    },
  );

  it.each([
    [
      "insert a framework",
      `INSERT INTO framework (id, code, edition, name_en, program, rollup_config, updated_at) VALUES (gen_random_uuid(), 'DEMO-HACK', '1', 'x', 'ambulatory', '{}', now())`,
    ],
    ["edit element text", `UPDATE element SET title_en = 'changed'`],
    ["activate a draft", `UPDATE framework SET status = 'active'`],
    ["delete a chapter", `DELETE FROM chapter`],
    [
      "add a department type",
      `INSERT INTO department_type (code, name_ar, name_en, sort) VALUES ('x', 'x', 'x', 99)`,
    ],
    ["read import staging", `SELECT 1 FROM framework_import LIMIT 1`],
  ])("does not let the app role %s", async (_, sql) => {
    await expect(withTenant(a.ctx, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(
      /permission denied/,
    );
  });
});
