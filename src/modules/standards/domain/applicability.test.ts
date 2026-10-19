import { describe, expect, it } from "vitest";
import {
  applicabilityChange,
  buildApplicabilityView,
  justificationProblem,
  resolveApplicability,
  suggestedPrograms,
} from "./applicability";

describe("suggestedPrograms", () => {
  it.each([
    ["hospital", ["hospital"]],
    ["polyclinic", ["ambulatory"]],
    ["primary_care", ["primary"]],
    ["dental", ["dental", "ambulatory"]],
    ["laboratory", ["lab"]],
    ["home_care", ["home_health"]],
    ["other", []],
    ["unknown", []],
  ])("%s → %j", (type, expected) => {
    expect(suggestedPrograms(type)).toEqual(expected);
  });
});

describe("resolveApplicability", () => {
  const anyType = { facilityTypes: [] };
  const hospitalsOnly = { facilityTypes: ["hospital"] };
  const na = { applicable: false, justification: "We do not provide this service." };
  const include = { applicable: true, justification: null };

  it.each([
    ["no facility types, no override", anyType, "polyclinic", null, true, "applies"],
    ["listed facility type", hospitalsOnly, "hospital", null, true, "applies"],
    ["other facility type", hospitalsOnly, "polyclinic", null, false, "otherFacilityType"],
    ["marked not applicable", anyType, "polyclinic", na, false, "markedNotApplicable"],
    ["marked N/A beats the type rule", hospitalsOnly, "hospital", na, false, "markedNotApplicable"],
    [
      "brought in despite the type rule",
      hospitalsOnly,
      "polyclinic",
      include,
      true,
      "markedApplicable",
    ],
  ] as const)("%s", (_, element, type, override, applicable, reason) => {
    expect(resolveApplicability(element, type, override)).toEqual({ applicable, reason });
  });
});

describe("justificationProblem", () => {
  it.each([
    [null, "tooShort"],
    ["", "tooShort"],
    ["n/a", "tooShort"],
    ["  short   ", "tooShort"],
    ["لا نقدم هذه الخدمة", null],
    ["We do not provide sedation.", null],
    ["x".repeat(1000), null],
    ["x".repeat(1001), "tooLong"],
  ])("%j → %s", (text, expected) => {
    expect(justificationProblem(text)).toBe(expected);
  });
});

describe("applicabilityChange", () => {
  const reason = "We do not run an inpatient service.";
  it.each([
    [
      "N/A on an element that applies",
      true,
      { applicable: false, justification: reason },
      { kind: "set", applicable: false, justification: reason },
    ],
    [
      "N/A without a reason",
      true,
      { applicable: false, justification: null },
      { kind: "invalid", problem: "tooShort" },
    ],
    [
      "N/A with a token reason",
      true,
      { applicable: false, justification: "  n/a  " },
      { kind: "invalid", problem: "tooShort" },
    ],
    [
      "N/A with an essay",
      true,
      { applicable: false, justification: "x".repeat(1001) },
      { kind: "invalid", problem: "tooLong" },
    ],
    [
      "bringing in an element of another type",
      false,
      { applicable: true, justification: "" },
      { kind: "set", applicable: true, justification: null },
    ],
    [
      "bringing in, with a note",
      false,
      { applicable: true, justification: " We run a small ward. " },
      { kind: "set", applicable: true, justification: "We run a small ward." },
    ],
    ["back to applicable", true, { applicable: true, justification: null }, { kind: "clear" }],
    [
      "back to the type rule's N/A",
      false,
      { applicable: false, justification: null },
      { kind: "clear" },
    ],
  ] as const)("%s", (_, byFramework, decision, expected) => {
    expect(applicabilityChange(byFramework, decision)).toEqual(expected);
  });
});

describe("buildApplicabilityView", () => {
  const content = {
    chapters: [
      { id: "c1", code: "DEMO-A", titleAr: "أ", titleEn: "A" },
      { id: "c2", code: "DEMO-B", titleAr: "ب", titleEn: "B" },
    ],
    standards: [
      { id: "s1", chapterId: "c1" },
      { id: "s2", chapterId: "c2" },
    ],
    elements: [
      {
        id: "e1",
        standardId: "s1",
        code: "DEMO-A.1.1",
        titleAr: null,
        titleEn: "1",
        isEsr: true,
        facilityTypes: [],
      },
      {
        id: "e2",
        standardId: "s1",
        code: "DEMO-A.1.2",
        titleAr: null,
        titleEn: "2",
        isEsr: false,
        facilityTypes: ["hospital"],
      },
      {
        id: "e3",
        standardId: "s2",
        code: "DEMO-B.1.1",
        titleAr: null,
        titleEn: "3",
        isEsr: false,
        facilityTypes: [],
      },
    ],
  };
  const decidedAt = new Date("2026-10-19T08:00:00Z");
  const overrides = [
    { elementId: "e1", applicable: false, justification: "We do not provide it.", decidedAt },
  ];

  it("resolves every element and counts the whole edition", () => {
    const view = buildApplicabilityView(content, "polyclinic", overrides);
    expect(view.counts).toEqual({ total: 3, applicable: 1, notApplicable: 2, esrNotApplicable: 1 });
    expect(view.groups.map((g) => g.elements.map((e) => [e.code, e.reason]))).toEqual([
      [
        ["DEMO-A.1.1", "markedNotApplicable"],
        ["DEMO-A.1.2", "otherFacilityType"],
      ],
      [["DEMO-B.1.1", "applies"]],
    ]);
    expect(view.groups[0]!.elements[0]).toMatchObject({
      justification: "We do not provide it.",
      decidedAt,
    });
  });

  it("follows the facility type", () => {
    const view = buildApplicabilityView(content, "hospital", []);
    expect(view.counts).toMatchObject({ applicable: 3, notApplicable: 0 });
  });

  it("filters by chapter and by N/A without changing the counts", () => {
    const byChapter = buildApplicabilityView(content, "polyclinic", overrides, {
      chapter: "DEMO-B",
    });
    expect(byChapter.groups.map((g) => g.chapter.code)).toEqual(["DEMO-B"]);
    expect(byChapter.shown).toBe(1);
    expect(byChapter.counts.total).toBe(3);

    const na = buildApplicabilityView(content, "polyclinic", overrides, {
      onlyNotApplicable: true,
    });
    expect(na.shown).toBe(2);
    expect(na.groups.map((g) => g.chapter.code)).toEqual(["DEMO-A"]);
  });
});
