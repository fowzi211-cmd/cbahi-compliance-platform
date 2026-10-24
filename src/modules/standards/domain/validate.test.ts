import { describe, expect, it } from "vitest";
import { defaultRollupConfig, defaultScale } from "./import-format";
import { readFlatCsv, readJson } from "./readers";
import { catalogues, demoJson, flatCsv, frameworkMeta } from "./test-fixtures";
import { validateWorkbook } from "./validate";

const validateJson = (data: unknown) => {
  const { workbook, issues } = readJson(JSON.stringify(data));
  expect(issues).toEqual([]);
  return validateWorkbook(workbook!, catalogues);
};

type Json = ReturnType<typeof demoJson>;
const withElement = (patch: Record<string, unknown>, index = 0): Json => {
  const json = demoJson();
  json.elements[index] = { ...json.elements[index]!, ...patch } as Json["elements"][number];
  return json;
};
const withFramework = (patch: Record<string, unknown>): Json => {
  const json = demoJson();
  return { ...json, framework: { ...json.framework, ...patch } };
};

describe("validateWorkbook: a valid file", () => {
  it("normalizes a JSON edition", () => {
    const { document, issues } = validateJson(demoJson());
    expect(issues).toEqual([]);
    expect(document).toEqual({
      framework: {
        code: "DEMO-TEST",
        edition: "2026.1",
        nameAr: "إطار تجريبي للاختبار",
        nameEn: "Demo test framework",
        program: "ambulatory",
        rollupConfig: defaultRollupConfig,
      },
      scale: defaultScale,
      chapters: [
        { code: "DEMO-A", titleAr: "فصل تجريبي أ", titleEn: "Demo chapter A" },
        { code: "DEMO-B", titleAr: "فصل تجريبي ب", titleEn: "Demo chapter B" },
      ],
      standards: [
        {
          code: "DEMO-A.1",
          chapterCode: "DEMO-A",
          titleAr: "معيار أ١",
          titleEn: "Standard A1",
          weight: 1,
        },
        {
          code: "DEMO-B.1",
          chapterCode: "DEMO-B",
          titleAr: "معيار ب١",
          titleEn: "Standard B1",
          weight: 2,
        },
      ],
      elements: [
        {
          code: "DEMO-A.1.1",
          standardCode: "DEMO-A.1",
          titleAr: "عنصر تجريبي ١",
          titleEn: "Demo element 1",
          descriptionAr: null,
          descriptionEn: null,
          isEsr: true,
          weight: 1,
          evidenceTypes: ["document", "observation"],
          facilityTypes: [],
          departmentTypes: ["nursing", "pharmacy"],
        },
        {
          code: "DEMO-A.1.2",
          standardCode: "DEMO-A.1",
          titleAr: "عنصر تجريبي ٢",
          titleEn: "Demo element 2",
          descriptionAr: null,
          descriptionEn: null,
          isEsr: false,
          weight: 1.5,
          evidenceTypes: [],
          facilityTypes: ["hospital"],
          departmentTypes: [],
        },
        {
          code: "DEMO-B.1.1",
          standardCode: "DEMO-B.1",
          titleAr: "عنصر تجريبي ٣",
          titleEn: "Demo element 3",
          descriptionAr: "وصف بديل",
          descriptionEn: "Placeholder description",
          isEsr: false,
          weight: 1,
          evidenceTypes: [],
          facilityTypes: [],
          departmentTypes: [],
        },
      ],
    });
  });

  it("normalizes the single-file CSV layout", () => {
    const { workbook } = readFlatCsv(flatCsv, frameworkMeta);
    const { document, issues } = validateWorkbook(workbook!, catalogues);
    expect(issues).toEqual([]);
    expect(document?.framework).toMatchObject({ code: "DEMO-CSV", program: "dental" });
    expect(document?.chapters.map((c) => c.titleEn)).toEqual(["Chapter A", "Chapter B"]);
    expect(document?.elements.map((e) => [e.code, e.isEsr, e.evidenceTypes])).toEqual([
      ["DEMO-A.1.1", true, ["document", "observation"]],
      ["DEMO-A.1.2", false, []],
      ["DEMO-B.1.1", false, ["interview"]],
    ]);
  });

  it("defaults the pass mark to 80% with no per-standard minimum", () => {
    expect(defaultRollupConfig.readiness).toEqual({ ready_score: 0.8, min_standard_score: null });
    const { document } = validateJson(
      withFramework({
        rollup_config: { readiness: { ready_score: 0.75, min_standard_score: 0.5 } },
      }),
    );
    expect(document?.framework.rollupConfig.readiness).toEqual({
      ready_score: 0.75,
      min_standard_score: 0.5,
    });
  });

  it("accepts a custom scale and roll-up configuration", () => {
    const json = withFramework({
      rollup_config: { standard: { method: "threshold", met_threshold: 0.8, pm_threshold: 0.4 } },
    });
    const { document, issues } = validateJson({
      ...json,
      scale: [
        { code: "YES", label_ar: "نعم", label_en: "Yes", value: 1, requires_evidence: true },
        { code: "NO", label_ar: "لا", label_en: "No", value: 0, generates_finding: true },
      ],
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([
      { severity: "error", code: "esrLevelNotInScale", sheet: "scale", value: "MET" },
      { severity: "error", code: "esrLevelNotInScale", sheet: "scale", value: "NM" },
    ]);
    expect(document).toBeNull();

    const fixed = validateJson({
      ...json,
      framework: {
        ...json.framework,
        rollup_config: { esr: { allowed_levels: ["YES", "NO"] } },
      },
      scale: [
        { code: "YES", label_ar: "نعم", label_en: "Yes", value: 1 },
        { code: "NO", label_ar: "لا", label_en: "No", value: 0 },
      ],
    });
    expect(fixed.issues).toEqual([]);
    expect(fixed.document?.scale.map((l) => l.code)).toEqual(["YES", "NO"]);
    expect(fixed.document?.framework.rollupConfig.esr.allowed_levels).toEqual(["YES", "NO"]);
  });

  it("warns, without blocking, about a missing translation and an unknown column", () => {
    const { document, issues } = validateJson(withElement({ title_en: null, notes: "x" }, 1));
    expect(document).not.toBeNull();
    expect(issues).toEqual([
      { severity: "warning", code: "unknownColumn", sheet: "elements", column: "notes" },
      {
        severity: "warning",
        code: "translationMissing",
        sheet: "elements",
        row: 2,
        column: "title_en",
      },
    ]);
  });

  it("warns about chapters and standards with nothing under them", () => {
    const json = demoJson();
    json.chapters.push({ code: "DEMO-C", title_ar: "ج", title_en: "C" });
    json.standards.push({ code: "DEMO-A.2", chapter_code: "DEMO-A", title_ar: "س", title_en: "S" });
    const { document, issues } = validateJson(json);
    expect(document).not.toBeNull();
    expect(issues.map((i) => [i.code, i.value])).toEqual([
      ["emptyChapter", "DEMO-C"],
      ["emptyStandard", "DEMO-A.2"],
    ]);
  });
});

describe("validateWorkbook: row errors", () => {
  // Each case breaks one thing in an otherwise valid file and expects exactly that error,
  // located at the sheet, row and column a person would fix.
  it.each([
    ["element without a code", withElement({ code: "" }), ["required", "elements", 1, "code"]],
    [
      "element code with spaces",
      withElement({ code: "A 1" }),
      ["invalidCode", "elements", 1, "code"],
    ],
    [
      "duplicate element code",
      withElement({ code: "DEMO-A.1.1" }, 1),
      ["duplicateCode", "elements", 2, "code"],
    ],
    [
      "unknown standard",
      withElement({ standard_code: "NOPE" }),
      ["unknownStandard", "elements", 1, "standard_code"],
    ],
    [
      "no title in either language",
      withElement({ title_ar: "", title_en: null }),
      ["titleMissing", "elements", 1, "title_ar"],
    ],
    [
      "title too long",
      withElement({ title_en: "x".repeat(501) }),
      ["tooLong", "elements", 1, "title_en"],
    ],
    [
      "ESR flag that is not yes/no",
      withElement({ is_esr: "sometimes" }),
      ["invalidBoolean", "elements", 1, "is_esr"],
    ],
    [
      "weight that is not a number",
      withElement({ weight: "heavy" }),
      ["invalidNumber", "elements", 1, "weight"],
    ],
    ["zero weight", withElement({ weight: 0 }), ["weightNotPositive", "elements", 1, "weight"]],
    [
      "unknown evidence type",
      withElement({ evidence_types: "photo" }),
      ["invalidEvidenceType", "elements", 1, "evidence_types"],
    ],
    [
      "unknown facility type",
      withElement({ facility_types: "spaceship" }),
      ["unknownFacilityType", "elements", 1, "facility_types"],
    ],
    [
      "unknown department type",
      withElement({ department_types: "kitchen" }),
      ["unknownDepartmentType", "elements", 1, "department_types"],
    ],
    [
      "lowercase framework code",
      withFramework({ code: "demo" }),
      ["invalidCode", "framework", 1, "code"],
    ],
    ["missing edition", withFramework({ edition: "" }), ["required", "framework", 1, "edition"]],
    [
      "unknown programme",
      withFramework({ program: "spa" }),
      ["invalidProgram", "framework", 1, "program"],
    ],
    [
      "framework without a name",
      withFramework({ name_ar: null, name_en: null }),
      ["titleMissing", "framework", 1, "name_ar"],
    ],
    [
      "pass mark above 100%",
      withFramework({ rollup_config: { readiness: { ready_score: 1.2 } } }),
      ["invalidRollupConfig", "framework", 1, "rollup_config"],
    ],
    [
      "invalid roll-up method",
      withFramework({ rollup_config: { chapter: { method: "vibes" } } }),
      ["invalidRollupConfig", "framework", 1, "rollup_config"],
    ],
    [
      "standard in an unknown chapter",
      {
        ...demoJson(),
        standards: [{ ...demoJson().standards[0]!, chapter_code: "X" }, demoJson().standards[1]!],
      },
      ["unknownChapter", "standards", 1, "chapter_code"],
    ],
  ] as const)("%s", (_, json, [code, sheet, row, column]) => {
    const { document, issues } = validateJson(json);
    expect(document).toBeNull();
    expect(issues.filter((i) => i.severity === "error")).toEqual([
      expect.objectContaining({ code, sheet, row, column }),
    ]);
  });

  it("collects every error in one pass", () => {
    const json = withElement({ code: "", weight: -1, is_esr: "?" });
    const { issues } = validateJson(json);
    expect(issues.map((i) => i.code)).toEqual(["required", "invalidBoolean", "weightNotPositive"]);
  });

  it("rejects scale values outside 0..1 and a scale with one level", () => {
    const { issues } = validateJson({
      ...demoJson(),
      scale: [{ code: "MET", label_en: "Met", label_ar: "م", value: 2 }],
    });
    expect(issues.map((i) => i.code)).toEqual([
      "valueOutOfRange",
      "scaleTooSmall",
      "esrLevelNotInScale",
    ]);
  });

  it("requires ESR elements to be able to fail", () => {
    const json = withFramework({ rollup_config: { esr: { allowed_levels: ["MET"] } } });
    expect(validateJson(json).issues.map((i) => i.code)).toEqual(["esrMissingNotMet"]);
  });

  it("requires the four sheets and their key columns", () => {
    const { workbook } = readJson(
      JSON.stringify({ framework: demoJson().framework, chapters: [] }),
    );
    const { issues } = validateWorkbook(workbook!, catalogues);
    expect(issues.map((i) => [i.code, i.sheet, i.column])).toEqual([
      ["missingSheet", "standards", undefined],
      ["missingSheet", "elements", undefined],
      ["missingColumn", "chapters", "code"],
    ]);
  });

  it("requires exactly one framework row and at least one element", () => {
    const { workbook } = readJson(JSON.stringify({ ...demoJson(), elements: [] }));
    workbook!.framework!.rows.push(workbook!.framework!.rows[0]!);
    workbook!.elements!.columns.push("code", "standard_code");
    const codes = validateWorkbook(workbook!, catalogues).issues.map((i) => i.code);
    expect(codes).toContain("noElements");
    expect(codes).toContain("frameworkRowCount");
  });

  it("refuses files with more elements than the limit", () => {
    const json = demoJson();
    const many = Array.from({ length: 5001 }, (_, i) => ({
      ...json.elements[2]!,
      code: `E${i}`,
    }));
    const { issues } = validateJson({ ...json, elements: many });
    expect(issues.map((i) => i.code)).toEqual(["tooManyElements"]);
  });
});
