import { describe, expect, it } from "vitest";
import { documentFilePath, exportFileName, exportReadme, exportTables } from "./export";

describe("exportTables", () => {
  it("lists each table once, with the tenant first and the audit log last", () => {
    expect(new Set(exportTables).size).toBe(exportTables.length);
    expect(exportTables[0]).toBe("tenant");
    expect(exportTables.at(-1)).toBe("audit_event");
  });
});

describe("documentFilePath", () => {
  it.each([
    [{ documentId: "d1", version: 2, fileName: "policy.pdf" }, "files/d1/v2-policy.pdf"],
    [
      { documentId: "d1", version: 1, fileName: "../../etc/passwd" },
      "files/d1/v1-.._.._etc_passwd",
    ],
    [
      { documentId: "d1", version: 1, fileName: "سياسة الثلاجة.pdf" },
      "files/d1/v1-سياسة الثلاجة.pdf",
    ],
    [{ documentId: "d1", version: 3, fileName: "" }, "files/d1/v3-file"],
  ])("%o", (input, path) => {
    expect(documentFilePath(input)).toBe(path);
  });
});

describe("exportFileName and exportReadme", () => {
  it("names the archive by day and lists every table with its row count", () => {
    expect(exportFileName("2026-10-21")).toBe("mustamir-export-2026-10-21.zip");
    const readme = exportReadme({
      tenantName: "Demo",
      generatedAt: "2026-10-21T06:00:00.000Z",
      tables: [
        { table: "facility", rows: 1 },
        { table: "document", rows: 12 },
      ],
      people: 3,
      files: 4,
    });
    expect(readme).toContain("Organization / المنظمة: Demo");
    expect(readme).toMatch(/facility\s+1/);
    expect(readme).toMatch(/document\s+12/);
    expect(readme).toContain("(4)");
  });
});
