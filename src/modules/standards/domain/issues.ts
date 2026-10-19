import type { SheetName } from "./import-format";

// Every problem the importer reports. The code is a translation key (standards.import.issues.*),
// so the same file gives the same messages in Arabic and English.
export const issueCodes = [
  // File level
  "emptyFile",
  "unreadableFile",
  "fileTooLarge",
  "unsupportedFormat",
  "invalidEncoding",
  "invalidJson",
  "unknownFormatVersion",
  "csvUnclosedQuote",
  "missingSheet",
  "missingColumn",
  "unknownColumn",
  "frameworkRowCount",
  "tooManyElements",
  "noElements",
  "editionExists",
  // Cell level
  "required",
  "invalidCode",
  "invalidEdition",
  "tooLong",
  "invalidNumber",
  "weightNotPositive",
  "valueOutOfRange",
  "invalidBoolean",
  "invalidProgram",
  "invalidEvidenceType",
  "unknownFacilityType",
  "unknownDepartmentType",
  "invalidRollupConfig",
  "titleMissing",
  "translationMissing",
  // Cross-row
  "duplicateCode",
  "unknownChapter",
  "unknownStandard",
  "conflictingDefinition",
  "emptyChapter",
  "emptyStandard",
  "scaleTooSmall",
  "esrLevelNotInScale",
  "esrMissingNotMet",
] as const;
export type IssueCode = (typeof issueCodes)[number];

export type ImportIssue = {
  severity: "error" | "warning";
  code: IssueCode;
  sheet?: SheetName;
  // The spreadsheet row (header = 1) or, for JSON, the 1-based position in the array.
  row?: number;
  column?: string;
  value?: string;
};

export const hasErrors = (issues: readonly ImportIssue[]) =>
  issues.some((i) => i.severity === "error");
