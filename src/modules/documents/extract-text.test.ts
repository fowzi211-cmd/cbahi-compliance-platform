import { describe, expect, it } from "vitest";
import { detectFileKind } from "./domain/file-type";
import { extractText } from "./extract-text";
import { makeDocx, makePdf } from "./test-files";

describe("extractText", () => {
  it("reads the text of a PDF", async () => {
    const pdf = makePdf(["Demo policy on fridges", "MRN: 556677"]);
    expect(detectFileKind(pdf)).toBe("pdf");
    const text = await extractText("pdf", pdf);
    expect(text).toContain("Demo policy on fridges");
    expect(text).toContain("MRN: 556677");
  });

  it("reads the text of a Word file", async () => {
    const docx = await makeDocx(["سياسة تجريبية", "DOB: 01/02/1990"]);
    expect(detectFileKind(docx)).toBe("docx");
    const text = await extractText("docx", docx);
    expect(text).toContain("سياسة تجريبية");
    expect(text).toContain("DOB: 01/02/1990");
  });

  it("returns null for kinds it does not read, and for damaged files", async () => {
    expect(await extractText("png", new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(await extractText("pdf", new TextEncoder().encode("%PDF-1.4 broken"))).toBeNull();
  });
});
