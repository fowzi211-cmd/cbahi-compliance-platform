import { esrFirst } from "./display";

// Shapes one edition for the library screen: filters by chapter, department, ESR and a
// search term, groups by standard, and lists ESR elements first.

export type BrowseChapter = {
  id: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  sort: number;
};
export type BrowseStandard = BrowseChapter & { chapterId: string };
export type BrowseElement = {
  id: string;
  standardId: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  isEsr: boolean;
  weight: number;
  sort: number;
  evidenceTypes: string[];
  facilityTypes: string[];
  departmentTypes: string[];
};

export type BrowseFilter = {
  chapter?: string;
  department?: string;
  esrOnly?: boolean;
  query?: string;
};

export type BrowseView = {
  chapters: (BrowseChapter & { elementCount: number; esrCount: number })[];
  // Department codes used anywhere in the edition, for the filter list.
  departmentCodes: string[];
  groups: {
    chapter: BrowseChapter;
    standards: { standard: BrowseStandard; elements: BrowseElement[] }[];
  }[];
  esr: BrowseElement[];
  total: number;
};

const matches = (element: BrowseElement, query: string) =>
  [
    element.code,
    element.titleAr,
    element.titleEn,
    element.descriptionAr,
    element.descriptionEn,
  ].some((value) => value?.toLocaleLowerCase().includes(query));

export function buildBrowseView(
  content: { chapters: BrowseChapter[]; standards: BrowseStandard[]; elements: BrowseElement[] },
  filter: BrowseFilter,
): BrowseView {
  const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;
  const chapters = [...content.chapters].sort(bySort);
  const standards = [...content.standards].sort(bySort);
  const standardChapter = new Map(standards.map((s) => [s.id, s.chapterId]));
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  const chapterFilter = chapters.find((c) => c.code === filter.chapter)?.id;

  const visible = content.elements.filter(
    (e) =>
      (!chapterFilter || standardChapter.get(e.standardId) === chapterFilter) &&
      (!filter.department || e.departmentTypes.includes(filter.department)) &&
      (!filter.esrOnly || e.isEsr) &&
      (query === "" || matches(e, query)),
  );

  const byStandard = new Map<string, BrowseElement[]>();
  for (const element of visible) {
    byStandard.set(element.standardId, [...(byStandard.get(element.standardId) ?? []), element]);
  }

  const groups = chapters
    .map((chapter) => ({
      chapter,
      standards: standards
        .filter((s) => s.chapterId === chapter.id && byStandard.has(s.id))
        .map((standard) => ({ standard, elements: esrFirst(byStandard.get(standard.id)!) })),
    }))
    .filter((group) => group.standards.length > 0);

  return {
    chapters: chapters.map((chapter) => {
      const inChapter = content.elements.filter(
        (e) => standardChapter.get(e.standardId) === chapter.id,
      );
      return {
        ...chapter,
        elementCount: inChapter.length,
        esrCount: inChapter.filter((e) => e.isEsr).length,
      };
    }),
    departmentCodes: [...new Set(content.elements.flatMap((e) => e.departmentTypes))],
    groups,
    // In reading order, so the list matches the groups below it.
    esr: groups.flatMap((g) => g.standards.flatMap((s) => s.elements.filter((e) => e.isEsr))),
    total: visible.length,
  };
}
