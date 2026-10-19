import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withSystem } from "@/lib/db";
import {
  getAssessmentSheet,
  getReadiness,
  listAssessments,
  saveElementScore,
  submitAssessment,
} from "@/modules/assessments/service";
import { listFindings } from "@/modules/findings/service";
import { setFacilityFrameworks } from "@/modules/standards/service";
import { createDepartment, addMembership, loadAccessContext } from "@/modules/tenancy/service";
import {
  archiveTemplate,
  createTemplate,
  getRun,
  getTemplateOptions,
  listTracers,
  startRun,
} from "@/modules/tracers/service";
import { createUser, makeTenant, publishDemoEdition, uniqueEmail } from "./helpers";

// M11: tracer templates, weighted sampling with a stored seed, and runs that feed
// ElementStatus like any other internal assessment.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let frameworkId: string;
let nursingId: string;
let chapterId: string;

const DAY = 86_400_000;
const start = new Date();
const at = (days: number) => new Date(start.getTime() + days * DAY);
const SEED = "0123456789abcdef0123456789abcdef";

async function member(role: "department_head" | "staff" | "viewer", departmentId: string | null) {
  const user = await createUser(uniqueEmail(role), role);
  await addMembership(tenant.ctx, {
    userId: user.id,
    facilityId: tenant.facility.id,
    departmentId: departmentId ?? undefined,
    role,
  });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

/** Walks every sampled element of a run at `levelCode`, with an observation where needed. */
async function walk(ctx: Parameters<typeof getRun>[0], runId: string, levelCode: string) {
  const sheet = (await getRun(ctx, runId))!.sheet;
  for (const element of sheet.chapters.flatMap((c) => c.standards.flatMap((s) => s.elements))) {
    await saveElementScore(ctx, runId, element.id, {
      levelCode: element.isEsr && levelCode === "PM" ? "NM" : levelCode,
      comment: "Seen on the ward.",
      evidence: { kind: "observation", note: "Checked two trolleys." },
    });
  }
}

beforeAll(async () => {
  tenant = await makeTenant("Tracers");
  // Six elements; element 2 and 5 belong to nursing departments.
  ({ frameworkId } = await publishDemoEdition({
    elements: ["1", "2", "3", "4", "5", "6"],
    departmentTypes: { "2": "nursing", "5": "nursing" },
  }));
  await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [frameworkId]);
  nursingId = (
    await createDepartment(tenant.ctx, {
      facilityId: tenant.facility.id,
      nameAr: "التمريض",
      nameEn: "Nursing",
      typeCode: "nursing",
    })
  ).id;
  chapterId = (await getTemplateOptions(tenant.ctx, tenant.facility.id))!.frameworks[0]!
    .chapters[0]!.id;
});

afterAll(disconnectDb);

describe("templates", () => {
  it("offers the editions, chapters, scopes and people to build one from", async () => {
    const options = (await getTemplateOptions(tenant.ctx, tenant.facility.id))!;
    expect(options.wholeFacility).toBe(true);
    expect(options.frameworks.map((f) => f.id)).toEqual([frameworkId]);
    expect(options.departments.map((d) => d.id)).toEqual([nursingId]);
    expect(options.people.map((p) => p.userId)).toContain(tenant.ctx.userId);
  });

  it("refuses a template without a name, outside its edition, or with an empty pool", async () => {
    const base = { frameworkId, sampleSize: 3, frequency: "weekly" as const };
    await expect(createTemplate(tenant.ctx, tenant.facility.id, base)).rejects.toThrow(
      "nameRequired",
    );
    await expect(
      createTemplate(tenant.ctx, tenant.facility.id, {
        ...base,
        nameEn: "X",
        chapterIds: [crypto.randomUUID()],
      }),
    ).rejects.toThrow("unknownChapter");
    await expect(
      createTemplate(tenant.ctx, tenant.facility.id, { ...base, nameEn: "X", sampleSize: 31 }),
    ).rejects.toThrow();
    const viewer = await member("viewer", null);
    await expect(
      createTemplate(tenant.ctx, tenant.facility.id, {
        ...base,
        nameEn: "X",
        assigneeUserId: viewer.userId,
      }),
    ).rejects.toThrow("unknownAssignee");
  });

  it("lets a department head manage tracers for their own department only", async () => {
    const head = await member("department_head", nursingId);
    expect((await getTemplateOptions(head, tenant.facility.id))!).toMatchObject({
      wholeFacility: false,
      departments: [{ id: nursingId }],
    });
    await expect(
      createTemplate(head, tenant.facility.id, {
        nameEn: "Whole facility",
        frameworkId,
        sampleSize: 2,
        frequency: "weekly",
      }),
    ).rejects.toThrow("tracer.manage");
    const id = await createTemplate(head, tenant.facility.id, {
      nameAr: "جولة التمريض",
      frameworkId,
      departmentId: nursingId,
      sampleSize: 5,
      frequency: "monthly",
    });
    // The nursing pool has two elements, so a run takes both.
    const runId = await startRun(head, id, at(0), SEED);
    const run = (await getRun(head, runId))!;
    expect(run.run).toMatchObject({ seed: SEED, poolSize: 2, sampleSize: 2 });
    expect(run.sheet.progress.total).toBe(2);
    expect(run.sheet.canScore).toBe(true);
  });
});

describe("runs", () => {
  let templateId: string;
  let staff: Awaited<ReturnType<typeof member>>;

  beforeAll(async () => {
    staff = await member("staff", nursingId);
    templateId = await createTemplate(tenant.ctx, tenant.facility.id, {
      nameAr: "جولة المنشأة",
      nameEn: "Facility walk",
      frameworkId,
      chapterIds: [chapterId],
      sampleSize: 3,
      frequency: "weekly",
      assigneeUserId: staff.userId,
    });
  });

  it("is due at once, and shows to the person it is assigned to", async () => {
    const [view] = (await listTracers(staff, tenant.facility.id, at(0))).templates.filter(
      (t) => t.id === templateId,
    );
    expect(view).toMatchObject({
      dueState: "due",
      openRunId: null,
      canRun: true,
      canManage: false,
    });
  });

  it("draws a reproducible sample of the requested size and hands it to the assignee", async () => {
    const runId = await startRun(tenant.ctx, templateId, at(0), SEED);
    const run = (await getRun(staff, runId))!;
    expect(run.run).toMatchObject({ seed: SEED, sampleSize: 3, poolSize: 6 });
    expect(run.sheet.assessment).toMatchObject({ kind: "tracer", assignedTo: staff.userId });
    expect(run.sheet.canScore).toBe(true);

    // The stored candidates and seed repeat the draw: same weights, same sample.
    expect(run.run.reproducible).toBe(true);

    // One open run per template; self-assessment lists leave tracer runs out.
    await expect(startRun(tenant.ctx, templateId, at(0))).rejects.toThrow("runInProgress");
    expect((await listAssessments(tenant.ctx, tenant.facility.id)).map((a) => a.id)).not.toContain(
      runId,
    );
  });

  it("is scored by its assignee, feeds element status and raises findings", async () => {
    const { runId } = await openRun();
    expect((await getReadiness(tenant.ctx, tenant.facility.id, at(0)))[0]!.scored).toBe(0);
    await walk(staff, runId, "PM");
    const result = await submitAssessment(staff, runId, at(0));
    expect(result.statusesUpdated).toBe(3);
    expect(result.findings).toBe(3);
    const readiness = (await getReadiness(tenant.ctx, tenant.facility.id, at(0)))[0]!;
    expect(readiness.scored).toBe(3);
    const findings = await listFindings(tenant.ctx, tenant.facility.id, { assessmentId: runId });
    expect(findings).toHaveLength(3);
  });

  it("weights the next draw toward the gaps the last run found", async () => {
    // Three elements are now partly met (weight 3); the other three are unverified (4).
    // Both kinds stay in the pool, but none of the fresh, fully met ones would outrank them.
    const runId = await startRun(tenant.ctx, templateId, at(1), "ffffffffffffffffffffffffffffffff");
    const stored = await withSystem((tx) =>
      tx.tracerRun.findUniqueOrThrow({ where: { assessmentId: runId } }),
    );
    const weights = (stored.candidates as { weight: number }[]).map((c) => c.weight).sort();
    expect(weights).toEqual([3, 3, 3, 4, 4, 4]);
  });

  it("goes back to not due after a run, and is overdue when a whole cycle is missed", async () => {
    const view = async (days: number) =>
      (await listTracers(tenant.ctx, tenant.facility.id, at(days))).templates.find(
        (t) => t.id === templateId,
      )!;
    expect(await view(2)).toMatchObject({ dueState: "notDue" });
    expect(await view(8)).toMatchObject({ dueState: "due" });
    expect(await view(15)).toMatchObject({ dueState: "overdue" });
  });

  it("is not visible to someone with no part in it", async () => {
    const other = await member("staff", null);
    expect((await listTracers(other, tenant.facility.id)).templates.map((t) => t.id)).not.toContain(
      templateId,
    );
    const { runId } = await openRun();
    expect(await getRun(other, runId)).toBeNull();
    await expect(startRun(other, templateId)).rejects.toThrow("notFound");
  });

  it("refuses to change a drawn sample", async () => {
    const { runId } = await openRun();
    const sheet = (await getAssessmentSheet(tenant.ctx, runId))!;
    expect(sheet.progress.total).toBe(3);
    await expect(
      withSystem((tx) =>
        tx.tracerRun.update({ where: { assessmentId: runId }, data: { seed: "0".repeat(32) } }),
      ),
    ).rejects.toThrow("tracer_run rows cannot change");
  });

  it("stops new runs once archived and keeps the old ones", async () => {
    const { runId } = await openRun();
    await archiveTemplate(tenant.ctx, templateId);
    await expect(startRun(tenant.ctx, templateId)).rejects.toThrow("notFound");
    expect(await getRun(tenant.ctx, runId)).not.toBeNull();
    expect(
      (await listTracers(tenant.ctx, tenant.facility.id)).templates.map((t) => t.id),
    ).not.toContain(templateId);
  });

  async function openRun() {
    const view = (await listTracers(tenant.ctx, tenant.facility.id)).runs.find(
      (r) => r.template.id === templateId && r.status === "in_progress",
    );
    if (view) return { runId: view.id };
    return { runId: await startRun(tenant.ctx, templateId) };
  }
});
