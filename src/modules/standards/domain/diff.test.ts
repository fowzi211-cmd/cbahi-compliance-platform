import { describe, expect, it } from "vitest";
import { diffEditions, type EditionContent } from "./diff";
import type { ElementInput } from "./import-format";

const element = (code: string, patch: Partial<ElementInput> = {}): ElementInput => ({
  code,
  standardCode: "S1",
  titleAr: `عنصر ${code}`,
  titleEn: `Element ${code}`,
  descriptionAr: null,
  descriptionEn: null,
  isEsr: false,
  weight: 1,
  evidenceTypes: ["document"],
  facilityTypes: [],
  departmentTypes: ["nursing", "pharmacy"],
  ...patch,
});

const content = (elements: ElementInput[]): EditionContent => ({
  chapters: [{ code: "C1", titleAr: "ف", titleEn: "C" }],
  standards: [{ code: "S1", chapterCode: "C1", titleAr: "م", titleEn: "S", weight: 1 }],
  elements,
});

describe("diffEditions", () => {
  it("treats everything as added when there is no earlier edition", () => {
    const diff = diffEditions(null, content([element("E1"), element("E2", { isEsr: true })]));
    expect(diff).toEqual({
      previousEdition: null,
      chapters: { added: ["C1"], removed: [], changed: [] },
      standards: { added: ["S1"], removed: [], changed: [] },
      elements: { added: ["E1", "E2"], removed: [], changed: [] },
      unchangedElements: 0,
      esr: { added: ["E2"], removed: [] },
    });
  });

  it("reports nothing for an identical edition, ignoring list order", () => {
    const before = content([element("E1")]);
    const after = content([element("E1", { departmentTypes: ["pharmacy", "nursing"] })]);
    const diff = diffEditions({ edition: "1", content: before }, after);
    expect(diff.elements).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.unchangedElements).toBe(1);
    expect(diff.previousEdition).toBe("1");
  });

  it("lists added, removed and changed elements with the changed fields", () => {
    const before = content([element("E1"), element("E2"), element("E3")]);
    const after = content([
      element("E1", { titleEn: "Reworded", weight: 2 }),
      element("E3"),
      element("E4"),
    ]);
    const diff = diffEditions({ edition: "1", content: before }, after);
    expect(diff.elements).toEqual({
      added: ["E4"],
      removed: ["E2"],
      changed: [{ code: "E1", fields: ["titleEn", "weight"] }],
    });
    expect(diff.unchangedElements).toBe(1);
  });

  it.each([
    ["standardCode", { standardCode: "S2" }],
    ["descriptionAr", { descriptionAr: "وصف" }],
    ["evidenceTypes", { evidenceTypes: ["kpi"] }],
    ["facilityTypes", { facilityTypes: ["dental"] }],
    ["departmentTypes", { departmentTypes: ["nursing"] }],
  ] as const)("detects a change in %s", (field, patch) => {
    const diff = diffEditions(
      { edition: "1", content: content([element("E1")]) },
      content([element("E1", patch as Partial<ElementInput>)]),
    );
    expect(diff.elements.changed).toEqual([{ code: "E1", fields: [field] }]);
  });

  it("calls out ESR changes separately, including removed ESR elements", () => {
    const before = content([
      element("E1", { isEsr: true }),
      element("E2"),
      element("E3", { isEsr: true }),
    ]);
    const after = content([
      element("E1"),
      element("E2", { isEsr: true }),
      element("E5", { isEsr: true }),
    ]);
    const diff = diffEditions({ edition: "1", content: before }, after);
    expect(diff.esr).toEqual({ added: ["E2", "E5"], removed: ["E1", "E3"] });
  });

  it("compares chapters and standards", () => {
    const before: EditionContent = {
      chapters: [
        { code: "C1", titleAr: "أ", titleEn: "A" },
        { code: "C2", titleAr: "ب", titleEn: "B" },
      ],
      standards: [{ code: "S1", chapterCode: "C1", titleAr: "م", titleEn: "S", weight: 1 }],
      elements: [],
    };
    const after: EditionContent = {
      chapters: [
        { code: "C1", titleAr: "أ", titleEn: "A renamed" },
        { code: "C3", titleAr: "ج", titleEn: "C" },
      ],
      standards: [{ code: "S1", chapterCode: "C1", titleAr: "م", titleEn: "S", weight: 3 }],
      elements: [],
    };
    const diff = diffEditions({ edition: "1", content: before }, after);
    expect(diff.chapters).toEqual({ added: ["C3"], removed: ["C2"], changed: ["C1"] });
    expect(diff.standards).toEqual({ added: [], removed: [], changed: ["S1"] });
  });
});
