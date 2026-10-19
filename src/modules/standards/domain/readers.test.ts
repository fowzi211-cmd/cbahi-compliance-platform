import { describe, expect, it } from "vitest";
import { readFlatCsv, readJson, sheetFromTable, normalizeHeader } from "./readers";
import { demoJson, flatCsv, flatCsvHeader, frameworkMeta } from "./test-fixtures";

describe("normalizeHeader", () => {
  it.each([
    ["Code", "code"],
    [" Title AR ", "title_ar"],
    ["standard-code", "standard_code"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe("sheetFromTable", () => {
  it("maps cells to headers and drops empty rows", () => {
    const sheet = sheetFromTable([
      { line: 1, fields: ["Code", "Title AR", ""] },
      { line: 2, fields: ["X", "س", "ignored"] },
      { line: 3, fields: ["", null, ""] },
    ]);
    expect(sheet.columns).toEqual(["code", "title_ar"]);
    expect(sheet.rows).toEqual([{ row: 2, values: { code: "X", title_ar: "س" } }]);
  });
});

describe("readJson", () => {
  it("reads every sheet with 1-based positions", () => {
    const { workbook, issues } = readJson(JSON.stringify(demoJson()));
    expect(issues).toEqual([]);
    expect(workbook?.framework?.rows).toHaveLength(1);
    expect(workbook?.elements?.rows.map((r) => r.row)).toEqual([1, 2, 3]);
    expect(workbook?.elements?.rows[0]?.values.evidence_types).toEqual(["document", "observation"]);
  });

  it("keeps a nested rollup_config as JSON text", () => {
    const json = demoJson();
    const { workbook } = readJson(
      JSON.stringify({
        ...json,
        framework: { ...json.framework, rollup_config: { chapter: { method: "all_must_meet" } } },
      }),
    );
    expect(workbook?.framework?.rows[0]?.values.rollup_config).toBe(
      '{"chapter":{"method":"all_must_meet"}}',
    );
  });

  it.each([
    ["not JSON", "{oops", "invalidJson"],
    ["an array", "[]", "invalidJson"],
    ["a different format version", '{"format":"other/v9"}', "unknownFormatVersion"],
  ])("rejects %s", (_, text, code) => {
    const { workbook, issues } = readJson(text);
    expect(workbook).toBeNull();
    expect(issues[0]?.code).toBe(code);
  });

  it("reports a sheet that is not a list and an entry that is not an object", () => {
    const { issues } = readJson(JSON.stringify({ ...demoJson(), chapters: {}, elements: [1] }));
    expect(issues).toEqual([
      { severity: "error", code: "invalidJson", sheet: "chapters" },
      { severity: "error", code: "invalidJson", sheet: "elements", row: 1 },
    ]);
  });
});

describe("readFlatCsv", () => {
  it("derives chapters and standards from the element rows", () => {
    const { workbook, issues } = readFlatCsv(flatCsv, frameworkMeta);
    expect(issues).toEqual([]);
    expect(workbook?.chapters?.rows.map((r) => r.values.code)).toEqual(["DEMO-A", "DEMO-B"]);
    expect(workbook?.standards?.rows.map((r) => [r.values.code, r.values.chapter_code])).toEqual([
      ["DEMO-A.1", "DEMO-A"],
      ["DEMO-B.1", "DEMO-B"],
    ]);
    expect(workbook?.elements?.rows).toHaveLength(3);
    expect(workbook?.elements?.columns).not.toContain("chapter_code");
    expect(workbook?.framework?.rows[0]?.values.code).toBe("DEMO-CSV");
  });

  it("reports a chapter defined with two different titles", () => {
    const csv = [
      flatCsvHeader,
      "DEMO-A,فصل أ,Chapter A,DEMO-A.1,,,E1,ع,E,,,",
      "DEMO-A,فصل آخر,Chapter A,DEMO-A.1,,,E2,ع,E,,,",
    ].join("\n");
    expect(readFlatCsv(csv, frameworkMeta).issues).toEqual([
      {
        severity: "error",
        code: "conflictingDefinition",
        sheet: "chapters",
        row: 3,
        column: "title_ar",
        value: "DEMO-A",
      },
    ]);
  });

  it("reports a standard placed in two chapters", () => {
    const csv = [flatCsvHeader, "C1,أ,A,S1,,,E1,ع,E,,,", "C2,ب,B,S1,,,E2,ع,E,,,"].join("\n");
    const codes = readFlatCsv(csv, frameworkMeta).issues.map((i) => [i.code, i.sheet, i.column]);
    expect(codes).toContainEqual(["conflictingDefinition", "standards", "chapter_code"]);
  });

  it.each([
    ["an empty file", "", "emptyFile"],
    ["an unclosed quote", 'chapter_code,standard_code,code\n"C1,S1,E1', "csvUnclosedQuote"],
    ["a missing required column", "chapter_code,code\nC1,E1", "missingColumn"],
  ])("rejects %s", (_, csv, code) => {
    const { workbook, issues } = readFlatCsv(csv, frameworkMeta);
    expect(workbook).toBeNull();
    expect(issues[0]?.code).toBe(code);
  });
});
