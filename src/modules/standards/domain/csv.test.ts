import { describe, expect, it } from "vitest";
import { CsvSyntaxError, detectDelimiter, parseCsv } from "./csv";

const fields = (text: string) => parseCsv(text).map((r) => r.fields);

describe("parseCsv", () => {
  it.each([
    [
      "simple rows",
      "a,b\n1,2\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "CRLF line endings",
      "a,b\r\n1,2\r\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "no trailing newline",
      "a,b\n1,2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "quoted delimiter",
      'a,b\n"x, y",2',
      [
        ["a", "b"],
        ["x, y", "2"],
      ],
    ],
    ["escaped quote", 'a\n"say ""hi"""', [["a"], ['say "hi"']]],
    [
      "newline inside quotes",
      'a,b\n"line 1\nline 2",2',
      [
        ["a", "b"],
        ["line 1\nline 2", "2"],
      ],
    ],
    [
      "empty fields",
      "a,b,c\n,,x",
      [
        ["a", "b", "c"],
        ["", "", "x"],
      ],
    ],
    ["blank lines skipped", "a\n\n1\n\n", [["a"], ["1"]]],
    [
      "byte-order mark removed",
      "﻿code,title\nX,Y",
      [
        ["code", "title"],
        ["X", "Y"],
      ],
    ],
    [
      "semicolon delimiter",
      "a;b\n1;2,5",
      [
        ["a", "b"],
        ["1", "2,5"],
      ],
    ],
    [
      "tab delimiter",
      "a\tb\n1\t2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "Arabic text",
      "رمز,عنوان\nأ,نص تجريبي",
      [
        ["رمز", "عنوان"],
        ["أ", "نص تجريبي"],
      ],
    ],
  ])("%s", (_, input, expected) => {
    expect(fields(input)).toEqual(expected);
  });

  it("records the line each row starts on", () => {
    expect(parseCsv('a\n"x\ny"\nz').map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it("rejects an unclosed quote and points at its line", () => {
    expect(() => parseCsv('a\nok\n"broken')).toThrowError(CsvSyntaxError);
    try {
      parseCsv('a\nok\n"broken');
    } catch (error) {
      expect((error as CsvSyntaxError).line).toBe(3);
    }
  });
});

describe("detectDelimiter", () => {
  it.each([
    ["a,b,c", ","],
    ["a;b;c", ";"],
    ["a\tb", "\t"],
    ['"a;b",c', ","],
    ["single", ","],
  ])("%j → %j", (header, expected) => {
    expect(detectDelimiter(header)).toBe(expected);
  });
});
