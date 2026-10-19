import { describe, expect, it } from "vitest";
import { buildBrowseView, type BrowseElement } from "./browse";

const chapters = [
  { id: "c2", code: "B", titleAr: "ب", titleEn: "B", sort: 2 },
  { id: "c1", code: "A", titleAr: "أ", titleEn: "A", sort: 1 },
];
const standards = [
  { id: "s1", chapterId: "c1", code: "A.1", titleAr: "م", titleEn: "S", sort: 1 },
  { id: "s2", chapterId: "c2", code: "B.1", titleAr: "م", titleEn: "S", sort: 2 },
  { id: "s3", chapterId: "c2", code: "B.2", titleAr: "م", titleEn: "S", sort: 3 },
];
const element = (
  id: string,
  standardId: string,
  sort: number,
  patch: Partial<BrowseElement> = {},
): BrowseElement => ({
  id,
  standardId,
  code: id.toUpperCase(),
  titleAr: `عنصر ${id}`,
  titleEn: `Element ${id}`,
  descriptionAr: null,
  descriptionEn: null,
  isEsr: false,
  weight: 1,
  sort,
  evidenceTypes: [],
  facilityTypes: [],
  departmentTypes: [],
  ...patch,
});
const elements = [
  element("e1", "s1", 1, { departmentTypes: ["nursing"] }),
  element("e2", "s1", 2, { isEsr: true }),
  element("e3", "s2", 3, { departmentTypes: ["pharmacy", "nursing"], descriptionEn: "Cold chain" }),
  element("e4", "s3", 4, { isEsr: true, departmentTypes: ["pharmacy"] }),
];
const content = { chapters, standards, elements };
const codes = (view: ReturnType<typeof buildBrowseView>) =>
  view.groups.flatMap((g) => g.standards.flatMap((s) => s.elements.map((e) => e.code)));

describe("buildBrowseView", () => {
  it("groups by chapter and standard in edition order with ESR first", () => {
    const view = buildBrowseView(content, {});
    expect(view.groups.map((g) => g.chapter.code)).toEqual(["A", "B"]);
    expect(codes(view)).toEqual(["E2", "E1", "E3", "E4"]);
    expect(view.esr.map((e) => e.code)).toEqual(["E2", "E4"]);
    expect(view.total).toBe(4);
  });

  it("counts elements and ESR per chapter regardless of the filter", () => {
    const view = buildBrowseView(content, { esrOnly: true });
    expect(view.chapters.map((c) => [c.code, c.elementCount, c.esrCount])).toEqual([
      ["A", 2, 1],
      ["B", 2, 1],
    ]);
    expect(view.departmentCodes.sort()).toEqual(["nursing", "pharmacy"]);
  });

  it.each([
    [{ chapter: "B" }, ["E3", "E4"]],
    [{ department: "nursing" }, ["E1", "E3"]],
    [{ department: "pharmacy", esrOnly: true }, ["E4"]],
    [{ esrOnly: true }, ["E2", "E4"]],
    [{ query: "cold" }, ["E3"]],
    [{ query: "e2" }, ["E2"]],
    [{ query: "عنصر e4" }, ["E4"]],
    [{ chapter: "UNKNOWN" }, ["E2", "E1", "E3", "E4"]],
    [{ chapter: "A", department: "pharmacy" }, []],
  ])("filters with %j", (filter, expected) => {
    expect(codes(buildBrowseView(content, filter))).toEqual(expected);
  });

  it("drops standards and chapters with nothing left after filtering", () => {
    const view = buildBrowseView(content, { department: "pharmacy" });
    expect(
      view.groups.map((g) => [g.chapter.code, g.standards.map((s) => s.standard.code)]),
    ).toEqual([["B", ["B.1", "B.2"]]]);
  });
});
