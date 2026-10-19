import type { ChapterInput, ElementInput, ImportDocument, StandardInput } from "./import-format";

// What changes for facilities if this edition replaces the current one. Elements are matched
// by code: a quality manager thinks in codes ("LD.3.2 changed"), and assessments made against
// the old edition stay linked to it, so a renamed code shows as removed + added.

export type EditionContent = Pick<ImportDocument, "chapters" | "standards" | "elements">;

export const elementFields = [
  "standardCode",
  "titleAr",
  "titleEn",
  "descriptionAr",
  "descriptionEn",
  "isEsr",
  "weight",
  "evidenceTypes",
  "facilityTypes",
  "departmentTypes",
] as const satisfies readonly (keyof ElementInput)[];
export type ElementField = (typeof elementFields)[number];

type Changes = { added: string[]; removed: string[]; changed: string[] };

export type EditionDiff = {
  // Null when there is no earlier edition: everything is new.
  previousEdition: string | null;
  chapters: Changes;
  standards: Changes;
  elements: {
    added: string[];
    removed: string[];
    changed: { code: string; fields: ElementField[] }[];
  };
  unchangedElements: number;
  // ESR changes are listed on their own: they change who is "Not ready" overnight.
  esr: { added: string[]; removed: string[] };
};

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000")
    : a === b;

function compare<T extends { code: string }>(
  before: readonly T[],
  after: readonly T[],
  fields: readonly (keyof T)[],
): Changes {
  const old = new Map(before.map((item) => [item.code, item]));
  const next = new Set(after.map((item) => item.code));
  return {
    added: after.filter((item) => !old.has(item.code)).map((item) => item.code),
    removed: before.filter((item) => !next.has(item.code)).map((item) => item.code),
    changed: after
      .filter((item) => {
        const previous = old.get(item.code);
        return previous && fields.some((f) => !sameValue(previous[f], item[f]));
      })
      .map((item) => item.code),
  };
}

const chapterFields: (keyof ChapterInput)[] = ["titleAr", "titleEn"];
const standardFields: (keyof StandardInput)[] = ["chapterCode", "titleAr", "titleEn", "weight"];

export function diffEditions(
  previous: { edition: string; content: EditionContent } | null,
  next: EditionContent,
): EditionDiff {
  const before = previous?.content ?? { chapters: [], standards: [], elements: [] };
  const oldElements = new Map(before.elements.map((e) => [e.code, e]));
  const nextCodes = new Set(next.elements.map((e) => e.code));

  const changed: EditionDiff["elements"]["changed"] = [];
  let unchanged = 0;
  for (const element of next.elements) {
    const old = oldElements.get(element.code);
    if (!old) continue;
    const fields = elementFields.filter((f) => !sameValue(old[f], element[f]));
    if (fields.length > 0) changed.push({ code: element.code, fields });
    else unchanged++;
  }

  return {
    previousEdition: previous?.edition ?? null,
    chapters: compare(before.chapters, next.chapters, chapterFields),
    standards: compare(before.standards, next.standards, standardFields),
    elements: {
      added: next.elements.filter((e) => !oldElements.has(e.code)).map((e) => e.code),
      removed: before.elements.filter((e) => !nextCodes.has(e.code)).map((e) => e.code),
      changed,
    },
    unchangedElements: unchanged,
    esr: {
      added: next.elements
        .filter((e) => e.isEsr && !oldElements.get(e.code)?.isEsr)
        .map((e) => e.code),
      removed: before.elements
        .filter((e) => e.isEsr && !next.elements.some((n) => n.code === e.code && n.isEsr))
        .map((e) => e.code),
    },
  };
}
