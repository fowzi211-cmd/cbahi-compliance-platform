import type { Catalogues } from "./validate";

// Fictional content for importer tests. Never real accreditation text.

export const catalogues: Catalogues = {
  facilityTypes: new Set(["hospital", "polyclinic", "dental"]),
  departmentTypes: new Set(["nursing", "pharmacy", "quality"]),
};

export function demoJson(overrides: Record<string, unknown> = {}) {
  return {
    format: "mustamir.framework/v1",
    framework: {
      code: "DEMO-TEST",
      edition: "2026.1",
      name_ar: "إطار تجريبي للاختبار",
      name_en: "Demo test framework",
      program: "ambulatory",
    },
    chapters: [
      { code: "DEMO-A", title_ar: "فصل تجريبي أ", title_en: "Demo chapter A" },
      { code: "DEMO-B", title_ar: "فصل تجريبي ب", title_en: "Demo chapter B" },
    ],
    standards: [
      { code: "DEMO-A.1", chapter_code: "DEMO-A", title_ar: "معيار أ١", title_en: "Standard A1" },
      {
        code: "DEMO-B.1",
        chapter_code: "DEMO-B",
        title_ar: "معيار ب١",
        title_en: "Standard B1",
        weight: 2,
      },
    ],
    elements: [
      {
        code: "DEMO-A.1.1",
        standard_code: "DEMO-A.1",
        title_ar: "عنصر تجريبي ١",
        title_en: "Demo element 1",
        is_esr: true,
        evidence_types: ["document", "observation"],
        department_types: "nursing|pharmacy",
      },
      {
        code: "DEMO-A.1.2",
        standard_code: "DEMO-A.1",
        title_ar: "عنصر تجريبي ٢",
        title_en: "Demo element 2",
        weight: "1.5",
        facility_types: "hospital",
      },
      {
        code: "DEMO-B.1.1",
        standard_code: "DEMO-B.1",
        title_ar: "عنصر تجريبي ٣",
        title_en: "Demo element 3",
        description_ar: "وصف بديل",
        description_en: "Placeholder description",
      },
    ],
    ...overrides,
  };
}

export const flatCsvHeader =
  "chapter_code,chapter_title_ar,chapter_title_en,standard_code,standard_title_ar,standard_title_en,code,title_ar,title_en,is_esr,evidence_types,department_types";

export const flatCsv = [
  flatCsvHeader,
  "DEMO-A,فصل أ,Chapter A,DEMO-A.1,معيار أ١,Standard A1,DEMO-A.1.1,عنصر ١,Element 1,yes,document|observation,nursing",
  "DEMO-A,,,DEMO-A.1,,,DEMO-A.1.2,عنصر ٢,Element 2,no,,",
  "DEMO-B,فصل ب,Chapter B,DEMO-B.1,معيار ب١,Standard B1,DEMO-B.1.1,عنصر ٣,Element 3,,interview,",
].join("\n");

export const frameworkMeta = {
  code: "DEMO-CSV",
  edition: "1",
  name_ar: "إطار CSV",
  name_en: "CSV framework",
  program: "dental",
};
