import { booleanCell, listCell, numberCell, textCell, type Cell } from "./cells";
import {
  defaultRollupConfig,
  defaultScale,
  editionPattern,
  evidenceTypes,
  frameworkCodePattern,
  itemCodePattern,
  limits,
  programs,
  rollupConfigSchema,
  scaleCodePattern,
  sheetColumns,
  type EvidenceType,
  type ImportDocument,
  type Program,
  type RollupConfig,
  type ScoreLevelInput,
  type SheetName,
} from "./import-format";
import { hasErrors, type ImportIssue, type IssueCode } from "./issues";
import type { RawRow, RawWorkbook } from "./readers";

/** Codes the platform knows, loaded from the catalogue tables by the service. */
export type Catalogues = {
  facilityTypes: ReadonlySet<string>;
  departmentTypes: ReadonlySet<string>;
};

export type ValidationResult = { document: ImportDocument | null; issues: ImportIssue[] };

/**
 * Checks a workbook against the import schema and returns the normalized edition. Every
 * problem is collected (not just the first), so a quality team can fix a file in one pass.
 * The document is returned only when there are no errors; warnings do not block.
 */
export function validateWorkbook(workbook: RawWorkbook, catalogues: Catalogues): ValidationResult {
  const issues: ImportIssue[] = [];
  const report = (
    severity: ImportIssue["severity"],
    code: IssueCode,
    where: { sheet?: SheetName; row?: number; column?: string; value?: string } = {},
  ) => issues.push({ severity, code, ...where });

  // --- Sheets and columns ---------------------------------------------------------------
  for (const sheet of ["framework", "chapters", "standards", "elements"] as const) {
    if (!workbook[sheet]) report("error", "missingSheet", { sheet });
  }
  for (const [sheet, spec] of Object.entries(sheetColumns) as [
    SheetName,
    (typeof sheetColumns)[SheetName],
  ][]) {
    const data = workbook[sheet];
    if (!data) continue;
    const known: readonly string[] = spec.all;
    for (const column of spec.required) {
      if (!data.columns.includes(column)) report("error", "missingColumn", { sheet, column });
    }
    for (const column of data.columns) {
      if (!known.includes(column)) report("warning", "unknownColumn", { sheet, column });
    }
  }
  if (hasErrors(issues)) return { document: null, issues };

  const elementRows = workbook.elements!.rows;
  if (elementRows.length === 0) report("error", "noElements", { sheet: "elements" });
  if (elementRows.length > limits.elements) {
    report("error", "tooManyElements", { sheet: "elements", value: String(limits.elements) });
    return { document: null, issues };
  }

  // --- Cell helpers -----------------------------------------------------------------------
  const at = (sheet: SheetName, row: RawRow, column: string) => ({ sheet, row: row.row, column });

  const code = (sheet: SheetName, row: RawRow, column: string, pattern: RegExp) => {
    const value = textCell(row.values[column]);
    if (value === null) report("error", "required", at(sheet, row, column));
    else if (!pattern.test(value))
      report("error", "invalidCode", { ...at(sheet, row, column), value });
    return value ?? "";
  };

  const text = (sheet: SheetName, row: RawRow, column: string, max: number) => {
    const value = textCell(row.values[column]);
    if (value !== null && value.length > max) {
      report("error", "tooLong", { ...at(sheet, row, column), value: String(max) });
    }
    return value;
  };

  // Bilingual pair: at least one language is required; a missing one is only a warning,
  // since the UI falls back to the other language with a "translation missing" badge.
  const pair = (sheet: SheetName, row: RawRow, base: string, max: number, required = true) => {
    const ar = text(sheet, row, `${base}_ar`, max);
    const en = text(sheet, row, `${base}_en`, max);
    if (ar === null && en === null) {
      if (required) report("error", "titleMissing", at(sheet, row, `${base}_ar`));
    } else if (ar === null || en === null) {
      report(
        "warning",
        "translationMissing",
        at(sheet, row, `${base}_${ar === null ? "ar" : "en"}`),
      );
    }
    return { ar, en };
  };

  const number = (sheet: SheetName, row: RawRow, column: string, fallback: number) => {
    const value = numberCell(row.values[column], fallback);
    if (value === undefined) {
      report("error", "invalidNumber", {
        ...at(sheet, row, column),
        value: String(row.values[column]),
      });
      return fallback;
    }
    return value;
  };

  const weight = (sheet: SheetName, row: RawRow, column: string) => {
    const value = number(sheet, row, column, 1);
    if (value <= 0)
      report("error", "weightNotPositive", { ...at(sheet, row, column), value: String(value) });
    return value;
  };

  const flag = (sheet: SheetName, row: RawRow, column: string, fallback: boolean) => {
    const cell: Cell = row.values[column];
    const value = booleanCell(cell, fallback);
    if (value === undefined) {
      report("error", "invalidBoolean", { ...at(sheet, row, column), value: String(cell) });
      return fallback;
    }
    return value;
  };

  const unique = (sheet: SheetName, seen: Set<string>, value: string, row: RawRow) => {
    if (value === "") return;
    if (seen.has(value)) report("error", "duplicateCode", { ...at(sheet, row, "code"), value });
    seen.add(value);
  };

  // --- Framework --------------------------------------------------------------------------
  const frameworkRows = workbook.framework!.rows;
  if (frameworkRows.length !== 1) {
    report("error", "frameworkRowCount", {
      sheet: "framework",
      value: String(frameworkRows.length),
    });
  }
  const fw = frameworkRows[0] ?? { row: 2, values: {} };
  const frameworkCode = code("framework", fw, "code", frameworkCodePattern);
  const editionValue = textCell(fw.values.edition);
  if (editionValue === null) report("error", "required", at("framework", fw, "edition"));
  else if (!editionPattern.test(editionValue)) {
    report("error", "invalidEdition", { ...at("framework", fw, "edition"), value: editionValue });
  }
  const name = pair("framework", fw, "name", limits.titleLength);
  const programValue = textCell(fw.values.program)?.toLowerCase() ?? null;
  if (programValue === null) report("error", "required", at("framework", fw, "program"));
  else if (!(programs as readonly string[]).includes(programValue)) {
    report("error", "invalidProgram", { ...at("framework", fw, "program"), value: programValue });
  }
  let rollupConfig: RollupConfig = defaultRollupConfig;
  const rollupText = textCell(fw.values.rollup_config);
  if (rollupText !== null) {
    try {
      const parsed = rollupConfigSchema.safeParse(JSON.parse(rollupText));
      if (parsed.success) rollupConfig = parsed.data;
      else report("error", "invalidRollupConfig", at("framework", fw, "rollup_config"));
    } catch {
      report("error", "invalidRollupConfig", at("framework", fw, "rollup_config"));
    }
  }

  // --- Scale --------------------------------------------------------------------------------
  let scale: ScoreLevelInput[] = defaultScale;
  const scaleRows = workbook.scale?.rows ?? [];
  if (scaleRows.length > 0) {
    const seen = new Set<string>();
    scale = scaleRows.map((row) => {
      const levelCode = code("scale", row, "code", scaleCodePattern);
      unique("scale", seen, levelCode, row);
      const label = pair("scale", row, "label", limits.titleLength);
      const value = number("scale", row, "value", Number.NaN);
      if (Number.isNaN(value)) report("error", "required", at("scale", row, "value"));
      else if (value < 0 || value > 1) {
        report("error", "valueOutOfRange", { ...at("scale", row, "value"), value: String(value) });
      }
      return {
        code: levelCode,
        labelAr: label.ar,
        labelEn: label.en,
        value,
        countsInDenominator: flag("scale", row, "counts_in_denominator", true),
        requiresEvidence: flag("scale", row, "requires_evidence", false),
        generatesFinding: flag("scale", row, "generates_finding", false),
      };
    });
    if (scale.length < 2) report("error", "scaleTooSmall", { sheet: "scale" });
  }
  const levelValue = new Map(scale.map((l) => [l.code, l.value]));
  const esrLevels = rollupConfig.esr.allowed_levels;
  const unknownEsrLevels = esrLevels.filter((level) => !levelValue.has(level));
  for (const level of unknownEsrLevels) {
    report("error", "esrLevelNotInScale", { sheet: "scale", value: level });
  }
  // An ESR element must be able to fail; otherwise the "any ESR not met" rule could never fire.
  if (unknownEsrLevels.length === 0 && !esrLevels.some((l) => levelValue.get(l)! < 1)) {
    report("error", "esrMissingNotMet", { sheet: "scale" });
  }

  // --- Chapters -------------------------------------------------------------------------
  const chapterCodes = new Set<string>();
  const chapters = workbook.chapters!.rows.map((row) => {
    const chapterCode = code("chapters", row, "code", itemCodePattern);
    unique("chapters", chapterCodes, chapterCode, row);
    const title = pair("chapters", row, "title", limits.titleLength);
    return { code: chapterCode, titleAr: title.ar, titleEn: title.en };
  });

  // --- Standards ------------------------------------------------------------------------
  const standardCodes = new Set<string>();
  const usedChapters = new Set<string>();
  const standards = workbook.standards!.rows.map((row) => {
    const standardCode = code("standards", row, "code", itemCodePattern);
    unique("standards", standardCodes, standardCode, row);
    const chapterCode = textCell(row.values.chapter_code) ?? "";
    if (chapterCode === "") report("error", "required", at("standards", row, "chapter_code"));
    else if (!chapterCodes.has(chapterCode)) {
      report("error", "unknownChapter", {
        ...at("standards", row, "chapter_code"),
        value: chapterCode,
      });
    }
    usedChapters.add(chapterCode);
    const title = pair("standards", row, "title", limits.titleLength);
    return {
      code: standardCode,
      chapterCode,
      titleAr: title.ar,
      titleEn: title.en,
      weight: weight("standards", row, "weight"),
    };
  });

  // --- Elements -------------------------------------------------------------------------
  const elementCodes = new Set<string>();
  const usedStandards = new Set<string>();
  const elements = elementRows.map((row) => {
    const elementCode = code("elements", row, "code", itemCodePattern);
    unique("elements", elementCodes, elementCode, row);
    const standardCode = textCell(row.values.standard_code) ?? "";
    if (standardCode === "") report("error", "required", at("elements", row, "standard_code"));
    else if (!standardCodes.has(standardCode)) {
      report("error", "unknownStandard", {
        ...at("elements", row, "standard_code"),
        value: standardCode,
      });
    }
    usedStandards.add(standardCode);
    const title = pair("elements", row, "title", limits.titleLength);
    const description = pair("elements", row, "description", limits.descriptionLength, false);

    const evidence = listCell(row.values.evidence_types);
    for (const value of evidence) {
      if (!(evidenceTypes as readonly string[]).includes(value)) {
        report("error", "invalidEvidenceType", { ...at("elements", row, "evidence_types"), value });
      }
    }
    const facilityTypes = listCell(row.values.facility_types);
    for (const value of facilityTypes) {
      if (!catalogues.facilityTypes.has(value)) {
        report("error", "unknownFacilityType", { ...at("elements", row, "facility_types"), value });
      }
    }
    const departmentTypes = listCell(row.values.department_types);
    for (const value of departmentTypes) {
      if (!catalogues.departmentTypes.has(value)) {
        report("error", "unknownDepartmentType", {
          ...at("elements", row, "department_types"),
          value,
        });
      }
    }

    return {
      code: elementCode,
      standardCode,
      titleAr: title.ar,
      titleEn: title.en,
      descriptionAr: description.ar,
      descriptionEn: description.en,
      isEsr: flag("elements", row, "is_esr", false),
      weight: weight("elements", row, "weight"),
      evidenceTypes: evidence as EvidenceType[],
      facilityTypes,
      departmentTypes,
    };
  });

  workbook.chapters!.rows.forEach((row, i) => {
    const chapterCode = chapters[i]!.code;
    if (chapterCode !== "" && !usedChapters.has(chapterCode)) {
      report("warning", "emptyChapter", { ...at("chapters", row, "code"), value: chapterCode });
    }
  });
  workbook.standards!.rows.forEach((row, i) => {
    const standardCode = standards[i]!.code;
    if (standardCode !== "" && !usedStandards.has(standardCode)) {
      report("warning", "emptyStandard", { ...at("standards", row, "code"), value: standardCode });
    }
  });

  if (hasErrors(issues)) return { document: null, issues };
  return {
    document: {
      framework: {
        code: frameworkCode,
        edition: editionValue!,
        nameAr: name.ar,
        nameEn: name.en,
        program: programValue as Program,
        rollupConfig,
      },
      scale,
      chapters,
      standards,
      elements,
    },
    issues,
  };
}
