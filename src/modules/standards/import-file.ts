import ExcelJS from "exceljs";
import type { Cell } from "./domain/cells";
import { importFormats, limits, sheetNames, type ImportFormat } from "./domain/import-format";
import {
  normalizeHeader,
  readFlatCsv,
  readJson,
  sheetFromTable,
  type RawWorkbook,
  type ReadResult,
} from "./domain/readers";

// Turns an uploaded file into the neutral workbook the validator understands. Only the
// platform admin can upload, and the size is capped before anything is parsed.

export function formatFromFileName(fileName: string): ImportFormat | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return (importFormats as readonly string[]).includes(extension)
    ? (extension as ImportFormat)
    : null;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Usually a CSV saved as Windows-1256 by an older Excel; the message tells the user to
    // export as "CSV UTF-8".
    return null;
  }
}

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    if ("error" in value) return null;
  }
  return String(value);
}

async function readXlsx(bytes: Uint8Array): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return { workbook: null, issues: [{ severity: "error", code: "unreadableFile" }] };
  }
  const result: RawWorkbook = {};
  workbook.eachSheet((worksheet) => {
    const name = normalizeHeader(worksheet.name);
    const sheet = sheetNames.find((s) => s === name);
    if (!sheet) return;
    const table: { line: number; fields: Cell[] }[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = row.values as ExcelJS.CellValue[];
      // ExcelJS rows are 1-based: index 0 is always empty.
      table.push({ line: rowNumber, fields: values.slice(1).map(cellValue) });
    });
    result[sheet] = sheetFromTable(table);
  });
  return { workbook: result, issues: [] };
}

export async function readImportFile(input: {
  fileName: string;
  bytes: Uint8Array;
  // Framework details for the single-file CSV layout, which has no framework sheet.
  framework: Record<string, string>;
}): Promise<ReadResult & { format: ImportFormat | null }> {
  const format = formatFromFileName(input.fileName);
  const fail = (code: "emptyFile" | "fileTooLarge" | "unsupportedFormat" | "invalidEncoding") => ({
    format,
    workbook: null,
    issues: [{ severity: "error" as const, code }],
  });

  if (input.bytes.byteLength === 0) return fail("emptyFile");
  if (input.bytes.byteLength > limits.fileBytes) return fail("fileTooLarge");
  if (!format) return fail("unsupportedFormat");
  if (format === "xlsx") return { format, ...(await readXlsx(input.bytes)) };

  const text = decodeUtf8(input.bytes);
  if (text === null) return fail("invalidEncoding");
  return { format, ...(format === "json" ? readJson(text) : readFlatCsv(text, input.framework)) };
}
