import type { Cell } from "./cells";
import { textCell } from "./cells";
import { CsvSyntaxError, parseCsv } from "./csv";
import { flatCsvColumns, formatVersion, sheetNames, type SheetName } from "./import-format";
import type { ImportIssue } from "./issues";

// Readers turn each file format into the same neutral workbook, so validation is written
// once. XLSX is read in ../xlsx-reader.ts (it needs a parsing library).

export type RawRow = { row: number; values: Record<string, Cell> };
export type RawSheet = { columns: string[]; rows: RawRow[] };
export type RawWorkbook = Partial<Record<SheetName, RawSheet>>;
export type ReadResult = { workbook: RawWorkbook | null; issues: ImportIssue[] };

/** Header names are matched loosely: case, spaces and dashes do not matter. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** A table whose first row is the header, as produced by CSV and XLSX readers. */
export function sheetFromTable(table: { line: number; fields: Cell[] }[]): RawSheet {
  const [header, ...body] = table;
  const columns = (header?.fields ?? []).map((h) => normalizeHeader(textCell(h) ?? ""));
  const rows = body
    .map(({ line, fields }) => {
      const values: Record<string, Cell> = {};
      columns.forEach((column, i) => {
        if (column !== "") values[column] = fields[i];
      });
      return { row: line, values };
    })
    .filter((r) => Object.values(r.values).some((v) => textCell(v) !== null));
  return { columns: columns.filter((c) => c !== ""), rows };
}

// The framework details a CSV upload takes from the form instead of a sheet.
export const frameworkFormFields = ["code", "edition", "name_ar", "name_en", "program"] as const;

const flatColumnMap: Record<string, { sheet: "chapters" | "standards"; column: string }> = {
  chapter_code: { sheet: "chapters", column: "code" },
  chapter_title_ar: { sheet: "chapters", column: "title_ar" },
  chapter_title_en: { sheet: "chapters", column: "title_en" },
  standard_title_ar: { sheet: "standards", column: "title_ar" },
  standard_title_en: { sheet: "standards", column: "title_en" },
  standard_weight: { sheet: "standards", column: "weight" },
};

/**
 * The single-file CSV layout: one row per element, with its chapter and standard repeated.
 * The framework details come from the upload form. A chapter or standard that appears with
 * different titles on different rows is reported, since one of them must be a typo.
 */
export function readFlatCsv(text: string, framework: Record<string, string>): ReadResult {
  let table;
  try {
    table = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvSyntaxError) {
      return {
        workbook: null,
        issues: [{ severity: "error", code: "csvUnclosedQuote", row: error.line }],
      };
    }
    throw error;
  }
  if (table.length === 0) {
    return { workbook: null, issues: [{ severity: "error", code: "emptyFile" }] };
  }

  const flat = sheetFromTable(table);
  const missing = flatCsvColumns.required.filter((c) => !flat.columns.includes(c));
  if (missing.length > 0) {
    return {
      workbook: null,
      issues: missing.map((column) => ({
        severity: "error" as const,
        code: "missingColumn" as const,
        sheet: "elements" as const,
        column,
      })),
    };
  }
  const issues: ImportIssue[] = [];
  const chapters = new Map<string, RawRow>();
  const standards = new Map<string, RawRow>();
  const elements: RawRow[] = [];

  const remember = (
    sheet: "chapters" | "standards",
    seen: Map<string, RawRow>,
    code: string | null,
    row: RawRow,
  ) => {
    if (code === null) return;
    const existing = seen.get(code);
    if (!existing) {
      seen.set(code, row);
      return;
    }
    for (const [column, value] of Object.entries(row.values)) {
      if (textCell(value) !== null && textCell(existing.values[column]) === null) {
        existing.values[column] = value;
      } else if (
        textCell(value) !== null &&
        textCell(value) !== textCell(existing.values[column])
      ) {
        issues.push({
          severity: "error",
          code: "conflictingDefinition",
          sheet,
          row: row.row,
          column,
          value: code,
        });
      }
    }
  };

  for (const { row, values } of flat.rows) {
    const chapterRow: RawRow = { row, values: {} };
    const standardRow: RawRow = {
      row,
      values: { code: values.standard_code, chapter_code: values.chapter_code },
    };
    const elementRow: RawRow = { row, values: {} };
    for (const [column, value] of Object.entries(values)) {
      const target = flatColumnMap[column];
      if (target?.sheet === "chapters") chapterRow.values[target.column] = value;
      else if (target?.sheet === "standards") standardRow.values[target.column] = value;
      else if (column !== "chapter_code") elementRow.values[column] = value;
    }
    remember("chapters", chapters, textCell(values.chapter_code), chapterRow);
    remember("standards", standards, textCell(values.standard_code), standardRow);
    elements.push(elementRow);
  }

  const pick = (sheet: "chapters" | "standards") =>
    Object.entries(flatColumnMap)
      .filter(([source, target]) => target.sheet === sheet && flat.columns.includes(source))
      .map(([, target]) => target.column);

  return {
    workbook: {
      framework: {
        columns: [...frameworkFormFields],
        rows: [
          {
            row: 1,
            values: Object.fromEntries(frameworkFormFields.map((f) => [f, framework[f] ?? null])),
          },
        ],
      },
      chapters: { columns: pick("chapters"), rows: [...chapters.values()] },
      standards: {
        columns: ["code", "chapter_code", ...pick("standards")],
        rows: [...standards.values()],
      },
      elements: {
        columns: flat.columns.filter((c) => !(c in flatColumnMap) && c !== "chapter_code"),
        rows: elements,
      },
    },
    issues,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function toCell(value: unknown): Cell {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) {
    return value as Cell;
  }
  if (Array.isArray(value)) return value;
  // Nested objects (only rollup_config) are kept as JSON text and parsed during validation.
  return JSON.stringify(value);
}

/** The JSON layout: `{ format, framework: {...}, scale: [...], chapters: [...], ... }`. */
export function readJson(text: string): ReadResult {
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { workbook: null, issues: [{ severity: "error", code: "invalidJson" }] };
  }
  if (!isRecord(data)) {
    return { workbook: null, issues: [{ severity: "error", code: "invalidJson" }] };
  }
  if (data.format !== undefined && data.format !== formatVersion) {
    return {
      workbook: null,
      issues: [{ severity: "error", code: "unknownFormatVersion", value: String(data.format) }],
    };
  }

  const issues: ImportIssue[] = [];
  const workbook: RawWorkbook = {};
  for (const sheet of sheetNames) {
    const raw = sheet === "framework" && isRecord(data.framework) ? [data.framework] : data[sheet];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      issues.push({ severity: "error", code: "invalidJson", sheet });
      continue;
    }
    const columns = new Set<string>();
    const rows: RawRow[] = [];
    raw.forEach((item, index) => {
      if (!isRecord(item)) {
        issues.push({ severity: "error", code: "invalidJson", sheet, row: index + 1 });
        return;
      }
      const values: Record<string, Cell> = {};
      for (const [key, value] of Object.entries(item)) {
        const column = normalizeHeader(key);
        columns.add(column);
        values[column] = toCell(value);
      }
      rows.push({ row: index + 1, values });
    });
    workbook[sheet] = { columns: [...columns], rows };
  }
  return { workbook, issues };
}
