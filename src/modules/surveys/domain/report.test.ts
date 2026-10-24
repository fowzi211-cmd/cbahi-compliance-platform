import { describe, expect, it } from "vitest";
import { reportFileName, reportSummary, type ReportElement, type ReportInput } from "./report";

const element = (code: string, over: Partial<ReportElement> = {}): ReportElement => ({
  code,
  titleAr: null,
  titleEn: `Element ${code}`,
  chapterCode: code.split(".").slice(0, 2).join("."),
  isEsr: false,
  levelCode: "MET",
  fullyMet: true,
  notApplicable: false,
  comment: null,
  ...over,
});

const base: ReportInput = {
  score: 0.9,
  scale: [
    { code: "MET", labelAr: null, labelEn: "Met" },
    { code: "PM", labelAr: null, labelEn: "Partially met" },
    { code: "NM", labelAr: null, labelEn: "Not met" },
    { code: "NA", labelAr: null, labelEn: "N/A" },
  ],
  chapters: [],
  elements: [element("DEMO-A.1.1"), element("DEMO-A.1.2")],
  findings: [],
  readyScore: 0.8,
  minStandardScore: null,
  standardsBelowMinimum: 0,
  esrBlocksReadiness: true,
};

describe("reportSummary verdict", () => {
  it.each([
    ["ready above the threshold", {}, "ready", []],
    ["at risk below the threshold", { score: 0.79 }, "at_risk", ["scoreBelowThreshold"]],
    ["ready exactly at the threshold", { score: 0.8 }, "ready", []],
    ["at risk with nothing to score", { score: null }, "at_risk", ["nothingToScore"]],
    [
      "at risk when a standard is below the per-standard minimum",
      { minStandardScore: 0.5, standardsBelowMinimum: 1 },
      "at_risk",
      ["standardBelowMinimum"],
    ],
    [
      "not ready when an ESR element is not fully met, whatever the score",
      {
        score: 1,
        elements: [element("DEMO-A.1.1", { isEsr: true, fullyMet: false, levelCode: "NM" })],
      },
      "not_ready",
      ["esrNotMet"],
    ],
    [
      "at risk instead when the edition does not let ESR block readiness",
      {
        esrBlocksReadiness: false,
        elements: [element("DEMO-A.1.1", { isEsr: true, fullyMet: false, levelCode: "PM" })],
      },
      "at_risk",
      ["esrNotMet"],
    ],
    [
      "ignores an ESR element scored N/A",
      {
        elements: [
          element("DEMO-A.1.1", {
            isEsr: true,
            fullyMet: false,
            notApplicable: true,
            levelCode: "NA",
          }),
        ],
      },
      "ready",
      [],
    ],
  ] as const)("%s", (_, over, verdict, reasons) => {
    const summary = reportSummary({ ...base, ...over });
    expect(summary.verdict).toBe(verdict);
    expect(summary.reasons).toEqual(reasons);
  });
});

describe("reportSummary contents", () => {
  it("counts levels, lists ESR not met and orders elements and findings", () => {
    const summary = reportSummary({
      ...base,
      elements: [
        element("DEMO-A.10.1"),
        element("DEMO-A.2.1", { isEsr: true, fullyMet: false, levelCode: "PM" }),
        element("DEMO-A.1.1", { levelCode: "NA", fullyMet: false, notApplicable: true }),
      ],
      findings: [
        {
          elementCode: "DEMO-B.1.1",
          titleAr: null,
          titleEn: null,
          severity: "medium",
          levelCode: "PM",
          statement: null,
        },
        {
          elementCode: "DEMO-A.3.1",
          titleAr: null,
          titleEn: null,
          severity: "high",
          levelCode: "NM",
          statement: null,
        },
        {
          elementCode: "DEMO-A.2.1",
          titleAr: null,
          titleEn: null,
          severity: "esr",
          levelCode: "PM",
          statement: null,
        },
        {
          elementCode: "DEMO-A.1.1",
          titleAr: null,
          titleEn: null,
          severity: "high",
          levelCode: "NM",
          statement: null,
        },
      ],
    });
    expect(summary.elements.map((e) => e.code)).toEqual([
      "DEMO-A.1.1",
      "DEMO-A.2.1",
      "DEMO-A.10.1",
    ]);
    expect(summary.levelCounts.map((l) => [l.code, l.count])).toEqual([
      ["MET", 1],
      ["PM", 1],
      ["NM", 0],
      ["NA", 1],
    ]);
    expect(summary.elementsScored).toBe(3);
    expect(summary.elementsCounted).toBe(2);
    expect(summary.esrNotMet).toEqual(["DEMO-A.2.1"]);
    expect(summary.findings.map((f) => f.elementCode)).toEqual([
      "DEMO-A.2.1",
      "DEMO-A.1.1",
      "DEMO-A.3.1",
      "DEMO-B.1.1",
    ]);
    expect(summary.findingCounts).toEqual([
      { severity: "esr", count: 1 },
      { severity: "high", count: 2 },
      { severity: "medium", count: 1 },
      { severity: "low", count: 0 },
    ]);
  });
});

describe("reportFileName", () => {
  it.each([
    [
      { frameworkCode: "DEMO-AMB", submittedOn: "2026-10-20", locale: "ar" },
      "mock-survey-DEMO-AMB-2026-10-20-ar.pdf",
    ],
    [
      { frameworkCode: "Hosp / 2026 (v2)", submittedOn: "2026-01-02", locale: "en" },
      "mock-survey-Hosp-2026-v2-2026-01-02-en.pdf",
    ],
    [
      { frameworkCode: "ألف", submittedOn: "2026-01-02", locale: "en" },
      "mock-survey-report-2026-01-02-en.pdf",
    ],
  ] as const)("%o", (input, name) => {
    expect(reportFileName(input)).toBe(name);
  });
});
