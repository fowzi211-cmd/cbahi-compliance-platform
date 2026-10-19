import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb } from "@/lib/db";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { listAuditEvents } from "@/modules/audit/service";
import { retireEdition } from "@/modules/standards/service";
import {
  decideApplicability,
  getApplicability,
  getFrameworkChoices,
  listFacilityFrameworks,
  setFacilityFrameworks,
} from "@/modules/standards/service";
import { getSurveyCycle, saveSurveyCycle } from "@/modules/surveys/service";
import {
  addMembership,
  archiveDepartment,
  completeOnboardingStep,
  createDepartment,
  getFacility,
  getOnboardingProgress,
  listDepartments,
  loadAccessContext,
  updateFacilityProfile,
  type AccessContext,
} from "@/modules/tenancy/service";
import { createUser, makeTenant, publishDemoEdition, uniqueEmail } from "./helpers";

let tenant: Awaited<ReturnType<typeof makeTenant>>;
let qualityManager: AccessContext;
let ambulatory: Awaited<ReturnType<typeof publishDemoEdition>>;
let hospital: Awaited<ReturnType<typeof publishDemoEdition>>;
const elementIds = new Map<string, string>();

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof DomainError
        ? error.code
        : error instanceof ForbiddenError
          ? "forbidden"
          : String(error),
  );

const profile = {
  nameAr: "مجمع تجريبي",
  nameEn: "Demo polyclinic",
  type: "polyclinic" as const,
  licenseNo: "DEMO-123",
  city: "الرياض",
};

beforeAll(async () => {
  tenant = await makeTenant("Onboarding");
  [ambulatory, hospital] = await Promise.all([
    // Element 3 is tied to hospitals, so a polyclinic sees it as not applicable by type.
    publishDemoEdition({ program: "ambulatory", facilityTypes: { "3": "hospital" } }),
    publishDemoEdition({ program: "hospital" }),
  ]);
  const qmUser = await createUser(uniqueEmail("qm"));
  await addMembership(tenant.ctx, {
    userId: qmUser.id,
    facilityId: tenant.facility.id,
    role: "quality_manager",
  });
  qualityManager = (await loadAccessContext(qmUser.id, tenant.tenant.id))!;
});

afterAll(disconnectDb);

describe("facility profile", () => {
  it("saves the profile, including the type, and audits the change", async () => {
    expect(await updateFacilityProfile(tenant.ctx, tenant.facility.id, profile)).toBe(true);
    expect(await getFacility(tenant.ctx, tenant.facility.id)).toMatchObject(profile);
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "facility",
      entityId: tenant.facility.id,
      limit: 1,
    });
    expect(event).toMatchObject({ action: "update" });
  });

  it("rejects a facility type outside the catalogue", async () => {
    expect(
      await codeOf(
        updateFacilityProfile(tenant.ctx, tenant.facility.id, {
          ...profile,
          type: "spa" as never,
        }),
      ),
    ).toMatch(/ZodError|invalid/i);
  });

  it("is an owner decision", async () => {
    expect(await codeOf(updateFacilityProfile(qualityManager, tenant.facility.id, profile))).toBe(
      "forbidden",
    );
  });
});

describe("frameworks", () => {
  it("suggests the editions whose programme matches the facility type", async () => {
    const choices = (await getFrameworkChoices(tenant.ctx, tenant.facility.id))!;
    expect(choices.firstVisit).toBe(true);
    const amb = choices.choices.find((c) => c.id === ambulatory.frameworkId)!;
    const hosp = choices.choices.find((c) => c.id === hospital.frameworkId)!;
    expect([amb.suggested, hosp.suggested]).toEqual([true, false]);
    expect(amb.selected).toBe(false);
  });

  it("needs at least one edition and only accepts live ones", async () => {
    expect(await codeOf(setFacilityFrameworks(tenant.ctx, tenant.facility.id, []))).toBe(
      "noFrameworks",
    );
    expect(
      await codeOf(setFacilityFrameworks(tenant.ctx, tenant.facility.id, [crypto.randomUUID()])),
    ).toBe("unknownFramework");
  });

  it("adds and removes editions, auditing the change", async () => {
    await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [
      ambulatory.frameworkId,
      hospital.frameworkId,
    ]);
    expect(
      await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [ambulatory.frameworkId]),
    ).toEqual({ added: 0, removed: 1 });
    const chosen = await listFacilityFrameworks(tenant.ctx, tenant.facility.id);
    expect(chosen.map((f) => f.id)).toEqual([ambulatory.frameworkId]);
    const [event] = await listAuditEvents(tenant.ctx, { entity: "facility_frameworks", limit: 1 });
    expect(event?.after).toEqual([`${ambulatory.code} 1`]);
    expect((await getFrameworkChoices(tenant.ctx, tenant.facility.id))!.firstVisit).toBe(false);
  });

  it("is an owner decision", async () => {
    expect(
      await codeOf(
        setFacilityFrameworks(qualityManager, tenant.facility.id, [hospital.frameworkId]),
      ),
    ).toBe("forbidden");
  });

  it("keeps a chosen edition after it is retired, but does not offer retired ones", async () => {
    const other = await makeTenant("Retired");
    const old = await publishDemoEdition({ program: "ambulatory" });
    await setFacilityFrameworks(other.ctx, other.facility.id, [old.frameworkId]);
    await retireEdition(old.admin, old.frameworkId);

    const choices = (await getFrameworkChoices(other.ctx, other.facility.id))!;
    expect(choices.choices.find((c) => c.id === old.frameworkId)).toMatchObject({
      selected: true,
      status: "retired",
    });
    // Keeping it is fine; adding a retired edition to a facility that never had it is not.
    expect(await setFacilityFrameworks(other.ctx, other.facility.id, [old.frameworkId])).toEqual({
      added: 0,
      removed: 0,
    });
    expect(
      await codeOf(setFacilityFrameworks(tenant.ctx, tenant.facility.id, [old.frameworkId])),
    ).toBe("unknownFramework");
  });
});

describe("element applicability", () => {
  beforeAll(async () => {
    const view = (await getApplicability(tenant.ctx, tenant.facility.id, ambulatory.frameworkId))!;
    for (const group of view.view.groups) {
      for (const element of group.elements) elementIds.set(element.code, element.id);
    }
  });

  it("applies the framework's facility-type rule", async () => {
    const view = (await getApplicability(tenant.ctx, tenant.facility.id, ambulatory.frameworkId))!;
    expect(view.view.counts).toEqual({
      total: 3,
      applicable: 2,
      notApplicable: 1,
      esrNotApplicable: 0,
    });
    const reasons = view.view.groups.flatMap((g) => g.elements.map((e) => e.reason));
    expect(reasons).toEqual(["applies", "applies", "otherFacilityType"]);
  });

  it("is null for an edition the facility does not use", async () => {
    expect(await getApplicability(tenant.ctx, tenant.facility.id, hospital.frameworkId)).toBeNull();
  });

  it("requires a justification to rule an element out", async () => {
    expect(
      await codeOf(
        decideApplicability(tenant.ctx, tenant.facility.id, elementIds.get("DEMO-X.1.1")!, {
          applicable: false,
          justification: "n/a",
        }),
      ),
    ).toBe("tooShort");
  });

  it("records an N/A decision on an ESR element, flags it, and audits it", async () => {
    const elementId = elementIds.get("DEMO-X.1.1")!;
    await decideApplicability(tenant.ctx, tenant.facility.id, elementId, {
      applicable: false,
      justification: "This fictional service is not provided here.",
    });
    const view = (await getApplicability(tenant.ctx, tenant.facility.id, ambulatory.frameworkId, {
      onlyNotApplicable: true,
    }))!;
    expect(view.view.counts.esrNotApplicable).toBe(1);
    expect(view.view.groups[0]!.elements.map((e) => [e.code, e.reason])).toEqual([
      ["DEMO-X.1.1", "markedNotApplicable"],
      ["DEMO-X.1.3", "otherFacilityType"],
    ]);
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "element_applicability",
      entityId: elementId,
      limit: 1,
    });
    expect(event).toMatchObject({ action: "create" });
    expect(event?.after).toMatchObject({ isEsr: true, applicable: false });
  });

  it("clears the override when the decision matches the framework again", async () => {
    const elementId = elementIds.get("DEMO-X.1.1")!;
    await decideApplicability(tenant.ctx, tenant.facility.id, elementId, {
      applicable: true,
      justification: null,
    });
    const view = (await getApplicability(tenant.ctx, tenant.facility.id, ambulatory.frameworkId))!;
    expect(view.view.counts.notApplicable).toBe(1);
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "element_applicability",
      entityId: elementId,
      limit: 1,
    });
    expect(event).toMatchObject({ action: "delete" });
  });

  it("lets the facility bring in an element tied to another facility type", async () => {
    await decideApplicability(tenant.ctx, tenant.facility.id, elementIds.get("DEMO-X.1.3")!, {
      applicable: true,
      justification: "",
    });
    const view = (await getApplicability(tenant.ctx, tenant.facility.id, ambulatory.frameworkId))!;
    expect(view.view.counts.applicable).toBe(3);
  });

  it("refuses elements of editions the facility does not use", async () => {
    const foreign = await getApplicability(tenant.ctx, tenant.facility.id, hospital.frameworkId);
    expect(foreign).toBeNull();
    expect(
      await codeOf(
        decideApplicability(tenant.ctx, tenant.facility.id, crypto.randomUUID(), {
          applicable: false,
          justification: "Not provided at this facility.",
        }),
      ),
    ).toBe("unknownElement");
  });

  it("is an owner decision", async () => {
    expect(
      await codeOf(
        decideApplicability(qualityManager, tenant.facility.id, elementIds.get("DEMO-X.1.2")!, {
          applicable: false,
          justification: "Not provided at this facility.",
        }),
      ),
    ).toBe("forbidden");
  });

  it("is backed by a database check as well", async () => {
    const { withTenant } = await import("@/lib/db");
    await expect(
      withTenant(
        tenant.ctx,
        (tx) => tx.$executeRaw`INSERT INTO element_applicability
          (id, tenant_id, facility_id, element_id, applicable, justification)
          VALUES (gen_random_uuid(), ${tenant.tenant.id}::uuid, ${tenant.facility.id}::uuid,
                  ${elementIds.get("DEMO-X.1.2")!}::uuid, false, 'no')`,
      ),
    ).rejects.toThrow(/element_applicability_na_justified/);
  });
});

describe("departments", () => {
  it("records the department type and rejects unknown ones", async () => {
    const department = await createDepartment(tenant.ctx, {
      facilityId: tenant.facility.id,
      nameAr: "التمريض",
      nameEn: "Nursing",
      typeCode: "nursing",
    });
    expect(department.typeCode).toBe("nursing");
    expect(
      await codeOf(
        createDepartment(tenant.ctx, {
          facilityId: tenant.facility.id,
          nameAr: "س",
          nameEn: "X",
          typeCode: "spa",
        }),
      ),
    ).toBe("unknownDepartmentType");
  });

  it("archives a department and audits it", async () => {
    const department = await createDepartment(tenant.ctx, {
      facilityId: tenant.facility.id,
      nameAr: "مؤقت",
      nameEn: "Temporary",
    });
    expect(await archiveDepartment(qualityManager, department.id).catch(() => "forbidden")).toBe(
      "forbidden",
    );
    expect(await archiveDepartment(tenant.ctx, department.id)).toBe(true);
    expect(await archiveDepartment(tenant.ctx, department.id)).toBe(false);
    const names = (await listDepartments(tenant.ctx, tenant.facility.id)).map((d) => d.nameEn);
    expect(names).not.toContain("Temporary");
    const [event] = await listAuditEvents(tenant.ctx, {
      entity: "department",
      entityId: department.id,
      limit: 1,
    });
    expect(event).toMatchObject({ action: "archive" });
  });
});

describe("survey cycle", () => {
  const now = new Date("2026-10-19T09:00:00Z");

  it("defaults to never surveyed", async () => {
    expect(await getSurveyCycle(tenant.ctx, tenant.facility.id)).toMatchObject({
      status: "never_surveyed",
      lastSurveyOn: null,
    });
  });

  it("stores calendar days exactly and audits the change", async () => {
    await saveSurveyCycle(
      tenant.ctx,
      tenant.facility.id,
      { status: "accredited", lastSurveyOn: "2025-02-28", nextExpectedOn: "2028-02-28" },
      now,
    );
    expect(await getSurveyCycle(tenant.ctx, tenant.facility.id)).toMatchObject({
      status: "accredited",
      lastSurveyOn: "2025-02-28",
      nextExpectedOn: "2028-02-28",
    });
    await saveSurveyCycle(
      tenant.ctx,
      tenant.facility.id,
      { status: "accredited", lastSurveyOn: "2025-03-01", nextExpectedOn: "2028-03-01" },
      now,
    );
    const [event] = await listAuditEvents(tenant.ctx, { entity: "survey_cycle", limit: 1 });
    expect(event).toMatchObject({ action: "update" });
    expect(event?.before).toMatchObject({ lastSurveyOn: "2025-02-28" });
  });

  it.each([
    [{ status: "accredited", lastSurveyOn: null, nextExpectedOn: null }, "lastSurveyRequired"],
    [{ status: "accredited", lastSurveyOn: "2026-12-01", nextExpectedOn: null }, "lastInFuture"],
    [
      { status: "accredited", lastSurveyOn: "2025-01-01", nextExpectedOn: "2024-01-01" },
      "nextBeforeLast",
    ],
    [{ status: "accredited", lastSurveyOn: "2025-02-30", nextExpectedOn: null }, "invalidDate"],
  ] as const)("rejects %j (%s)", async (input, code) => {
    expect(await codeOf(saveSurveyCycle(tenant.ctx, tenant.facility.id, input, now))).toBe(code);
  });

  it("is an owner decision", async () => {
    expect(
      await codeOf(
        saveSurveyCycle(qualityManager, tenant.facility.id, { status: "never_surveyed" }, now),
      ),
    ).toBe("forbidden");
  });
});

describe("onboarding progress", () => {
  it("marks the facility onboarded once every step is saved, and only once", async () => {
    const fresh = await makeTenant("Progress");
    expect(await getOnboardingProgress(fresh.ctx, fresh.facility.id)).toEqual({
      done: [],
      next: "facility",
      onboardedAt: null,
    });
    const steps = ["survey", "facility", "frameworks", "applicability", "departments"] as const;
    for (const step of steps) await completeOnboardingStep(fresh.ctx, fresh.facility.id, step);
    expect(await getOnboardingProgress(fresh.ctx, fresh.facility.id)).toMatchObject({
      next: "people",
      onboardedAt: null,
    });

    const finishedAt = new Date("2026-10-19T10:00:00Z");
    const result = await completeOnboardingStep(fresh.ctx, fresh.facility.id, "people", finishedAt);
    expect(result).toMatchObject({ next: null, onboardedAt: finishedAt });
    await completeOnboardingStep(fresh.ctx, fresh.facility.id, "facility", new Date());
    const progress = (await getOnboardingProgress(fresh.ctx, fresh.facility.id))!;
    expect(progress.onboardedAt).toEqual(finishedAt);
    expect(progress.done).toEqual([
      "facility",
      "frameworks",
      "applicability",
      "departments",
      "people",
      "survey",
    ]);
    const events = await listAuditEvents(fresh.ctx, { entity: "onboarding" });
    expect(events.map((e) => e.action)).toEqual(["complete"]);
  });

  it("is an owner action", async () => {
    expect(await codeOf(completeOnboardingStep(qualityManager, tenant.facility.id, "people"))).toBe(
      "forbidden",
    );
  });
});
