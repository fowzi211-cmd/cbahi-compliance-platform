import { describe, expect, it } from "vitest";
import { esrFirst, localized } from "./display";

describe("localized", () => {
  it.each([
    ["ar", "نص", "Text", { text: "نص", missing: false, lang: "ar" }],
    ["en", "نص", "Text", { text: "Text", missing: false, lang: "en" }],
    ["en", "نص", null, { text: "نص", missing: true, lang: "ar" }],
    ["ar", null, "Text", { text: "Text", missing: true, lang: "en" }],
    ["ar", "", "Text", { text: "Text", missing: true, lang: "en" }],
    ["ar", null, null, { text: "", missing: true, lang: "en" }],
  ] as const)("%s with (%j, %j)", (locale, ar, en, expected) => {
    expect(localized(locale, ar, en)).toEqual(expected);
  });
});

describe("esrFirst", () => {
  it("puts ESR elements first and keeps the edition order within each group", () => {
    const elements = [
      { code: "A", isEsr: false, sort: 1 },
      { code: "B", isEsr: true, sort: 2 },
      { code: "C", isEsr: false, sort: 3 },
      { code: "D", isEsr: true, sort: 4 },
    ];
    expect(esrFirst(elements).map((e) => e.code)).toEqual(["B", "D", "A", "C"]);
    expect(elements.map((e) => e.code)).toEqual(["A", "B", "C", "D"]);
  });
});
