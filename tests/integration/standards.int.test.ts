import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withSystem } from "@/lib/db";
import { facilityTypes } from "@/modules/tenancy/service";
import { DomainError, ForbiddenError } from "@/lib/errors";
import {
  activateEdition,
  browseEdition,
  browseLibrary,
  commitImport,
  deleteDraft,
  discardImport,
  getEdition,
  getImport,
  listLibrary,
  previewImport,
  retireEdition,
  setLicenseNote,
  type PlatformActor,
} from "@/modules/standards/service";
import {
  createUser,
  demoEditionJson,
  makeTenant,
  uniqueEmail,
  uniqueFrameworkCode,
} from "./helpers";

let admin: PlatformActor;
let tenant: Awaited<ReturnType<typeof makeTenant>>;
const bytes = (text: string) => new TextEncoder().encode(text);
const LICENSE = "Fictional demo content for tests.";

async function importEdition(json: string, fileName = "edition.json") {
  const preview = await previewImport(admin, { fileName, bytes: bytes(json), framework: {} });
  if (!preview.ok) throw new Error(JSON.stringify(preview.issues));
  return { importId: preview.importId, frameworkId: await commitImport(admin, preview.importId) };
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof DomainError ? error.code : String(error)),
  );

beforeAll(async () => {
  const user = await createUser(uniqueEmail("platform-admin"));
  admin = { userId: user.id, isPlatformAdmin: true };
  tenant = await makeTenant("Library");
});

afterAll(disconnectDb);

describe("programmes and facility types", () => {
  // The facility-type list in code and the catalogue the migrations seed must not drift:
  // Facility.type has a foreign key to the catalogue, and onboarding offers the code list.
  it("the facility_type catalogue matches the code list, in order", async () => {
    const types = await withSystem((tx) => tx.facilityType.findMany({ orderBy: { sort: "asc" } }));
    expect(types.map((t) => t.code)).toEqual([...facilityTypes]);
  });

  it.each(["seasonal_hospital", "acs", "dialysis"])(
    "imports an edition for %s",
    async (program) => {
      const { frameworkId } = await importEdition(
        demoEditionJson(uniqueFrameworkCode(), "1", { program }),
      );
      const edition = await getEdition(admin, frameworkId);
      expect(edition?.program).toBe(program);
    },
  );
});

describe("import preview", () => {
  it("stores a valid file with its report and audits it", async () => {
    const code = uniqueFrameworkCode();
    const preview = await previewImport(admin, {
      fileName: "demo.json",
      bytes: bytes(demoEditionJson(code, "1")),
      framework: {},
    });
    expect(preview).toMatchObject({ ok: true });
    const stored = await getImport(admin, (preview as { importId: string }).importId);
    expect(stored?.status).toBe("validated");
    expect(stored?.report.counts).toEqual({
      chapters: 1,
      standards: 1,
      elements: 3,
      esr: 1,
      scaleLevels: 4,
    });
    expect(stored?.report.diff.previousEdition).toBeNull();
    expect(stored?.report.diff.elements.added).toHaveLength(3);

    const audit = await withSystem((tx) =>
      tx.auditEvent.findFirst({
        where: { tenantId: null, entity: "framework_import", entityId: stored!.id },
      }),
    );
    expect(audit?.actorUserId).toBe(admin.userId);
    expect(audit?.after).toMatchObject({ code, edition: "1", format: "json" });
  });

  it("reports errors without storing anything", async () => {
    // Counted per admin: other test files import editions in parallel.
    const mine = () =>
      withSystem((tx) => tx.frameworkImport.count({ where: { createdBy: admin.userId } }));
    const before = await mine();
    const preview = await previewImport(admin, {
      fileName: "broken.csv",
      bytes: bytes("chapter_code,standard_code,code,department_types\nC1,S1,E1,kitchen"),
      framework: { code: "DEMO-CSV", edition: "1", name_en: "CSV", program: "dental" },
    });
    expect(preview).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unknownDepartmentType",
          sheet: "elements",
          row: 2,
          value: "kitchen",
        }),
      ]),
    });
    expect(await mine()).toBe(before);
  });

  it.each([
    ["an unsupported extension", "standards.pdf", bytes("%PDF"), "unsupportedFormat"],
    ["an empty file", "empty.csv", new Uint8Array(), "emptyFile"],
    [
      "a non-UTF-8 CSV",
      "legacy.csv",
      new Uint8Array([0x63, 0x6f, 0x64, 0x65, 0x0a, 0xc7, 0xe1]),
      "invalidEncoding",
    ],
    ["a corrupt workbook", "book.xlsx", bytes("not a zip"), "unreadableFile"],
    ["an oversized file", "big.json", new Uint8Array(5 * 1024 * 1024 + 1), "fileTooLarge"],
  ])("refuses %s", async (_, fileName, content, code) => {
    const preview = await previewImport(admin, { fileName, bytes: content, framework: {} });
    expect(preview).toEqual({ ok: false, issues: [expect.objectContaining({ code })] });
  });

  it("refuses an edition that already exists", async () => {
    const code = uniqueFrameworkCode();
    await importEdition(demoEditionJson(code, "1"));
    const again = await previewImport(admin, {
      fileName: "again.json",
      bytes: bytes(demoEditionJson(code, "1")),
      framework: {},
    });
    expect(again).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "editionExists" })],
    });
  });

  it("is only for the platform admin", async () => {
    const someone = { userId: admin.userId, isPlatformAdmin: false };
    await expect(
      previewImport(someone, { fileName: "x.json", bytes: bytes("{}"), framework: {} }),
    ).rejects.toThrow(ForbiddenError);
    await expect(activateEdition(someone, admin.userId)).rejects.toThrow(ForbiddenError);
  });
});

describe("editions", () => {
  it("commits a draft that tenants cannot see until it is licensed and activated", async () => {
    const code = uniqueFrameworkCode();
    const { importId, frameworkId } = await importEdition(demoEditionJson(code, "2026.1"));

    expect((await getEdition(admin, frameworkId))?.status).toBe("draft");
    expect(await codeOf(commitImport(admin, importId))).toBe("importNotPending");
    expect((await listLibrary(tenant.ctx)).some((f) => f.id === frameworkId)).toBe(false);
    expect(await browseLibrary(tenant.ctx, frameworkId, {})).toBeNull();
    // The admin can read the draft before putting it live.
    expect((await browseEdition(admin, frameworkId, {}))?.view.total).toBe(3);

    expect(await codeOf(activateEdition(admin, frameworkId))).toBe("licenseRequired");
    await setLicenseNote(admin, frameworkId, LICENSE);
    await activateEdition(admin, frameworkId);

    const library = await listLibrary(tenant.ctx);
    expect(library.find((f) => f.id === frameworkId)).toMatchObject({
      code,
      status: "active",
      esrCount: 1,
    });
    const browse = await browseLibrary(tenant.ctx, frameworkId, { department: "nursing" });
    expect(browse?.view.total).toBe(1);
    expect(browse?.departments.map((d) => d.code)).toEqual(["nursing"]);
    expect(await codeOf(setLicenseNote(admin, frameworkId, " "))).toBe("licenseRequired");
    expect(await codeOf(deleteDraft(admin, frameworkId))).toBe("notDraft");
  });

  it("compares a new edition with the live one and retires the old edition on activation", async () => {
    const code = uniqueFrameworkCode();
    const v1 = await importEdition(demoEditionJson(code, "1", { esr: ["1"] }));
    await setLicenseNote(admin, v1.frameworkId, LICENSE);
    await activateEdition(admin, v1.frameworkId);

    const preview = await previewImport(admin, {
      fileName: "v2.json",
      bytes: bytes(demoEditionJson(code, "2", { esr: ["2"], elements: ["1", "2", "4"] })),
      framework: {},
    });
    const report = (await getImport(admin, (preview as { importId: string }).importId))!.report;
    expect(report.diff).toMatchObject({
      previousEdition: "1",
      elements: {
        added: ["DEMO-X.1.4"],
        removed: ["DEMO-X.1.3"],
        changed: [
          { code: "DEMO-X.1.1", fields: ["isEsr"] },
          { code: "DEMO-X.1.2", fields: ["isEsr"] },
        ],
      },
      esr: { added: ["DEMO-X.1.2"], removed: ["DEMO-X.1.1"] },
    });

    const v2 = await commitImport(admin, (preview as { importId: string }).importId);
    await setLicenseNote(admin, v2, LICENSE);
    const now = new Date("2026-10-19T09:00:00Z");
    await activateEdition(admin, v2, now);

    expect(await getEdition(admin, v1.frameworkId)).toMatchObject({
      status: "retired",
      retiredAt: now,
    });
    expect(await getEdition(admin, v2)).toMatchObject({ status: "active", activatedAt: now });
    const live = (await listLibrary(tenant.ctx)).filter((f) => f.code === code);
    expect(live.map((f) => f.edition)).toEqual(["2"]);
    // A retired edition stays readable: past assessments point at its text.
    expect((await browseLibrary(tenant.ctx, v1.frameworkId, {}))?.edition.status).toBe("retired");

    const audits = await withSystem((tx) =>
      tx.auditEvent.findMany({
        where: { tenantId: null, entity: "framework", entityId: { in: [v1.frameworkId, v2] } },
        orderBy: { chainSeq: "asc" },
      }),
    );
    expect(audits.map((e) => [e.entityId === v2 ? "v2" : "v1", e.action])).toEqual([
      ["v1", "create"],
      ["v1", "update"],
      ["v1", "activate"],
      ["v2", "create"],
      ["v2", "update"],
      ["v1", "retire"],
      ["v2", "activate"],
    ]);
  });

  it("retires a live edition and deletes a draft", async () => {
    const code = uniqueFrameworkCode();
    const live = await importEdition(demoEditionJson(code, "1"));
    await setLicenseNote(admin, live.frameworkId, LICENSE);
    await activateEdition(admin, live.frameworkId);
    await retireEdition(admin, live.frameworkId);
    expect(await codeOf(retireEdition(admin, live.frameworkId))).toBe("notActive");
    expect(await codeOf(activateEdition(admin, live.frameworkId))).toBe("notDraft");

    const draft = await importEdition(demoEditionJson(code, "2"));
    await deleteDraft(admin, draft.frameworkId);
    expect(await getEdition(admin, draft.frameworkId)).toBeNull();
    expect((await getImport(admin, draft.importId))?.frameworkId).toBeNull();
  });

  it("discards a pending import", async () => {
    const preview = await previewImport(admin, {
      fileName: "x.json",
      bytes: bytes(demoEditionJson(uniqueFrameworkCode(), "1")),
      framework: {},
    });
    const importId = (preview as { importId: string }).importId;
    await discardImport(admin, importId);
    expect((await getImport(admin, importId))?.status).toBe("discarded");
    expect(await codeOf(commitImport(admin, importId))).toBe("importNotPending");
    expect(await codeOf(discardImport(admin, importId))).toBe("importNotPending");
  });

  it("enforces one live edition per code and a licence in the database too", async () => {
    const code = uniqueFrameworkCode();
    const one = await importEdition(demoEditionJson(code, "1"));
    const two = await importEdition(demoEditionJson(code, "2"));
    await expect(
      withSystem((tx) =>
        tx.framework.update({ where: { id: one.frameworkId }, data: { status: "active" } }),
      ),
    ).rejects.toThrow(/framework_active_needs_license/);
    await withSystem((tx) =>
      tx.framework.updateMany({
        where: { id: { in: [one.frameworkId, two.frameworkId] } },
        data: { licenseNote: LICENSE },
      }),
    );
    await activateEdition(admin, one.frameworkId);
    await expect(
      withSystem((tx) =>
        tx.framework.update({ where: { id: two.frameworkId }, data: { status: "active" } }),
      ),
    ).rejects.toThrow(/Unique constraint|framework_one_active_per_code/);
  });
});

describe("library access", () => {
  it("is for members only", async () => {
    const outsider = { ...tenant.ctx, actor: { ...tenant.ctx.actor, memberships: [] } };
    await expect(listLibrary(outsider)).rejects.toThrow(ForbiddenError);
  });

  it("returns null for an id that is not a UUID", async () => {
    expect(await browseLibrary(tenant.ctx, "not-a-uuid", {})).toBeNull();
  });
});
