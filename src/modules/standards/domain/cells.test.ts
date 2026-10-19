import { describe, expect, it } from "vitest";
import { booleanCell, latinDigits, listCell, numberCell, textCell } from "./cells";

describe("textCell", () => {
  it.each([
    ["  padded  ", "padded"],
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
    [3, "3"],
    [true, "true"],
    [["a", "b"], "a, b"],
    ["line 1\nline 2", "line 1\nline 2"],
  ] as const)("%j → %j", (cell, expected) => {
    expect(textCell(cell)).toBe(expected);
  });
});

describe("booleanCell", () => {
  it.each([
    [true, true],
    [false, false],
    ["yes", true],
    ["Y", true],
    ["TRUE", true],
    ["1", true],
    ["١", true],
    ["نعم", true],
    ["x", true],
    ["no", false],
    ["0", false],
    ["لا", false],
    ["", false],
    [null, false],
    ["maybe", undefined],
  ] as const)("%j → %j", (cell, expected) => {
    expect(booleanCell(cell, false)).toBe(expected);
  });

  it("uses the fallback for an empty cell", () => {
    expect(booleanCell("", true)).toBe(true);
  });
});

describe("numberCell", () => {
  it.each([
    [2, 2],
    ["1.5", 1.5],
    [" 3 ", 3],
    [".5", 0.5],
    ["٢٫٥", 2.5],
    ["۳", 3],
    ["", 1],
    [null, 1],
    ["1,5", undefined],
    ["abc", undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
  ] as const)("%j → %j", (cell, expected) => {
    expect(numberCell(cell, 1)).toBe(expected);
  });
});

describe("listCell", () => {
  it.each([
    ["document|observation", ["document", "observation"]],
    ["Document, Observation", ["document", "observation"]],
    ["a;b", ["a", "b"]],
    ["أ،ب", ["أ", "ب"]],
    [
      ["kpi", "kpi", " Interview "],
      ["kpi", "interview"],
    ],
    ["", []],
    [null, []],
    ["a||b", ["a", "b"]],
  ] as const)("%j → %j", (cell, expected) => {
    expect(listCell(cell)).toEqual(expected);
  });
});

describe("latinDigits", () => {
  it("converts Arabic-Indic and Persian digits and the Arabic decimal separator", () => {
    expect(latinDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ ١٫٥")).toBe("0123456789 0123456789 1.5");
  });
});
