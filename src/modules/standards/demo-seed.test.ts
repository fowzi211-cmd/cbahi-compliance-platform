import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJson } from "./domain/readers";
import { validateWorkbook } from "./domain/validate";

// Guards the seed: it must stay valid, the size the roadmap asks for, and plainly fictional.
// Real CBAHI/JCI/MOH text must never be committed (CLAUDE.md).
const text = readFileSync(path.join(process.cwd(), "prisma/seed/demo-amb.json"), "utf8");
const catalogues = {
  facilityTypes: new Set([
    "hospital",
    "polyclinic",
    "primary_care",
    "dental",
    "laboratory",
    "home_care",
    "seasonal_hospital",
    "other",
  ]),
  departmentTypes: new Set(
    "administration quality reception outpatient emergency nursing pharmacy laboratory radiology dental infection_control sterilization facility_management human_resources health_information".split(
      " ",
    ),
  ),
};

describe("DEMO-AMB seed", () => {
  const { workbook } = readJson(text);
  const { document, issues } = validateWorkbook(workbook!, catalogues);

  it("is a valid import file", () => {
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(document).not.toBeNull();
  });

  it("has about 8 chapters, 60 elements and 10 ESR elements", () => {
    expect(document!.chapters).toHaveLength(8);
    expect(document!.elements).toHaveLength(60);
    expect(document!.elements.filter((e) => e.isEsr)).toHaveLength(10);
  });

  it("ties a couple of elements to hospitals, so a clinic sees the facility-type rule", () => {
    const tied = document!.elements.filter((e) => e.facilityTypes.length > 0);
    expect(tied.map((e) => [e.code, e.facilityTypes, e.isEsr])).toEqual([
      ["DEMO-CARE.2.3", ["hospital"], false],
      ["DEMO-CARE.3.1", ["hospital"], false],
    ]);
  });

  it("uses DEMO- codes and marks every title as placeholder text", () => {
    for (const item of [...document!.chapters, ...document!.standards, ...document!.elements]) {
      expect(item.code).toMatch(/^DEMO-/);
      expect(item.titleAr).toMatch(/تجريبي/);
      if (item.titleEn !== null) expect(item.titleEn).toMatch(/demo/i);
    }
  });
});
