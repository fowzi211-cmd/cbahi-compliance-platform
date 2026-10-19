import { describe, expect, it } from "vitest";
import { elementScoreProblems, type ElementScoreInput } from "./element-score";
import { testScale } from "./test-scale";

const esr = { allowedLevels: ["MET", "NM"], anyNotMetBlocksReadiness: true };
const base: ElementScoreInput = {
  levelCode: "MET",
  isEsr: false,
  applicable: true,
  evidenceCount: 1,
  comment: null,
};

describe("elementScoreProblems", () => {
  it.each<[string, Partial<ElementScoreInput>, string[]]>([
    ["MET with evidence", {}, []],
    ["MET without evidence", { evidenceCount: 0 }, ["evidenceRequired"]],
    ["PM with evidence", { levelCode: "PM" }, []],
    ["PM without evidence", { levelCode: "PM", evidenceCount: 0 }, ["evidenceRequired"]],
    ["NM needs no evidence", { levelCode: "NM", evidenceCount: 0 }, []],
    [
      "NA with a reason",
      { levelCode: "NA", evidenceCount: 0, comment: "No case this quarter." },
      [],
    ],
    ["NA without a reason", { levelCode: "NA", evidenceCount: 0 }, ["commentRequired"]],
    ["NA with a blank reason", { levelCode: "NA", comment: "   " }, ["commentRequired"]],
    ["ESR MET", { isEsr: true }, []],
    ["ESR NM", { isEsr: true, levelCode: "NM", evidenceCount: 0 }, []],
    ["ESR PM", { isEsr: true, levelCode: "PM" }, ["esrLevelNotAllowed"]],
    [
      "ESR PM without evidence: both problems",
      { isEsr: true, levelCode: "PM", evidenceCount: 0 },
      ["esrLevelNotAllowed", "evidenceRequired"],
    ],
    [
      "ESR NA is not an allowed level",
      { isEsr: true, levelCode: "NA", comment: "x" },
      ["esrLevelNotAllowed"],
    ],
    ["unknown level", { levelCode: "EXCELLENT" }, ["unknownLevel"]],
    ["element ruled out for the facility", { applicable: false }, ["elementNotApplicable"]],
  ])("%s", (_, override, expected) => {
    expect(elementScoreProblems({ ...base, ...override }, testScale, esr)).toEqual(expected);
  });

  it("follows the edition's ESR configuration", () => {
    const lenient = { allowedLevels: ["MET", "PM", "NM"], anyNotMetBlocksReadiness: true };
    expect(
      elementScoreProblems({ ...base, isEsr: true, levelCode: "PM" }, testScale, lenient),
    ).toEqual([]);
  });
});
