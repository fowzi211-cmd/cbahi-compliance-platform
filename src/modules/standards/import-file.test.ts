import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { catalogues } from "./domain/test-fixtures";
import { validateWorkbook } from "./domain/validate";
import { formatFromFileName, readImportFile } from "./import-file";

async function workbookBytes(sheets: Record<string, unknown[][]>) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    rows.forEach((row) => sheet.addRow(row));
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("formatFromFileName", () => {
  it.each([
    ["edition.JSON", "json"],
    ["الإطار.xlsx", "xlsx"],
    ["a.b.csv", "csv"],
    ["notes.txt", null],
    ["noextension", null],
  ])("%s → %s", (name, expected) => {
    expect(formatFromFileName(name)).toBe(expected);
  });
});

describe("readImportFile with XLSX", () => {
  it("reads the multi-sheet layout, including numbers, booleans and rich text", async () => {
    const bytes = await workbookBytes({
      Framework: [
        ["code", "edition", "name_ar", "name_en", "program"],
        ["DEMO-XLSX", 2026, "إطار", "Workbook framework", "primary"],
      ],
      Chapters: [
        ["Code", "Title AR", "Title EN"],
        ["DEMO-A", "فصل", "Chapter"],
      ],
      Standards: [
        ["code", "chapter_code", "title_ar", "title_en", "weight"],
        ["DEMO-A.1", "DEMO-A", "معيار", "Standard", 2],
      ],
      Elements: [
        ["code", "standard_code", "title_ar", "title_en", "is_esr", "evidence_types"],
        [
          "DEMO-A.1.1",
          "DEMO-A.1",
          "عنصر",
          { richText: [{ text: "Rich " }, { text: "title" }] },
          true,
          "document|kpi",
        ],
        [],
        ["DEMO-A.1.2", "DEMO-A.1", "عنصر ٢", "Element 2", false, ""],
      ],
      "Notes for editors": [["ignored"]],
    });
    const read = await readImportFile({ fileName: "edition.xlsx", bytes, framework: {} });
    expect(read.format).toBe("xlsx");
    expect(read.issues).toEqual([]);
    expect(read.workbook?.elements?.rows.map((r) => r.row)).toEqual([2, 4]);

    const { document, issues } = validateWorkbook(read.workbook!, catalogues);
    expect(issues).toEqual([]);
    expect(document?.framework).toMatchObject({
      code: "DEMO-XLSX",
      edition: "2026",
      program: "primary",
    });
    expect(document?.standards[0]?.weight).toBe(2);
    expect(document?.elements[0]).toMatchObject({
      titleEn: "Rich title",
      isEsr: true,
      evidenceTypes: ["document", "kpi"],
    });
  });

  it("points row errors at the spreadsheet row", async () => {
    const bytes = await workbookBytes({
      framework: [
        ["code", "edition", "name_en", "program"],
        ["DEMO-XLSX", "1", "F", "primary"],
      ],
      chapters: [
        ["code", "title_en"],
        ["C", "Chapter"],
      ],
      standards: [
        ["code", "chapter_code", "title_en"],
        ["S", "C", "Standard"],
      ],
      elements: [
        ["code", "standard_code", "title_en"],
        ["E1", "S", "One"],
        ["E2", "MISSING", "Two"],
      ],
    });
    const read = await readImportFile({ fileName: "x.xlsx", bytes, framework: {} });
    const { issues } = validateWorkbook(read.workbook!, catalogues);
    expect(issues.filter((i) => i.severity === "error")).toEqual([
      {
        severity: "error",
        code: "unknownStandard",
        sheet: "elements",
        row: 3,
        column: "standard_code",
        value: "MISSING",
      },
    ]);
  });
});
