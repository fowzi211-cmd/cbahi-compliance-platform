import { describe, expect, it } from "vitest";
import { evidenceProblem, inScope, progress, unscoredElements } from "./assessment";

describe("inScope", () => {
  const nursing = { departmentTypes: ["nursing", "pharmacy"], applicable: true };
  const facilityWide = { departmentTypes: [], applicable: true };
  it.each([
    ["whole facility, department element", nursing, undefined, true],
    ["whole facility, facility-wide element", facilityWide, undefined, true],
    ["department of a listed type", nursing, "pharmacy", true],
    ["department of another type", nursing, "laboratory", false],
    ["department, facility-wide element", facilityWide, "nursing", false],
    ["department without a type", nursing, null, false],
    ["ruled-out element, whole facility", { ...nursing, applicable: false }, undefined, false],
    ["ruled-out element, department", { ...nursing, applicable: false }, "nursing", false],
  ] as const)("%s", (_, element, type, expected) => {
    expect(inScope(element, type)).toBe(expected);
  });
});

describe("evidenceProblem", () => {
  it.each([
    [{ kind: "document", note: null, url: "https://dms.example/doc/1" }, null],
    [{ kind: "document", note: "policy", url: "http://intranet.example/p" }, null],
    [{ kind: "document", note: "policy", url: null }, "urlRequired"],
    [{ kind: "document", note: null, url: "javascript:alert(1)" }, "invalidUrl"],
    [{ kind: "document", note: null, url: "not a link" }, "invalidUrl"],
    [{ kind: "observation", note: "Fridge log complete for the month", url: null }, null],
    [{ kind: "interview", note: "  ", url: null }, "noteRequired"],
    [{ kind: "record_review", note: null, url: "https://x.example" }, "noteRequired"],
    [{ kind: "kpi", note: "Compliance 96%", url: null }, null],
  ] as const)("%o → %s", (input, expected) => {
    expect(evidenceProblem(input)).toBe(expected);
  });
});

describe("unscoredElements and progress", () => {
  const scope = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("lists what is left, in order", () => {
    expect(unscoredElements(scope, new Set(["b"]))).toEqual(["a", "c"]);
    expect(unscoredElements(scope, new Set(["a", "b", "c", "x"]))).toEqual([]);
  });
  it("ignores scores outside the scope", () => {
    expect(progress(scope, new Set(["a", "x"]))).toEqual({ total: 3, scored: 1 });
  });
});
