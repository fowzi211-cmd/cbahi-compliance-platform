import { describe, expect, it } from "vitest";
import { detectFileKind } from "./file-type";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)),
  );
const zip = [0x50, 0x4b, 0x03, 0x04];

describe("detectFileKind", () => {
  it.each([
    ["a PDF", bytes("%PDF-1.7\n..."), "pdf"],
    ["a PNG", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "png"],
    ["a JPEG", bytes([0xff, 0xd8, 0xff, 0xe0, 0]), "jpeg"],
    ["a Word file", bytes(zip, "....[Content_Types].xml....word/document.xml...."), "docx"],
    ["an Excel file", bytes(zip, "....xl/workbook.xml...."), "xlsx"],
    ["any other zip", bytes(zip, "....payload.exe...."), null],
    ["an executable", bytes("MZ\x90\x00"), null],
    ["HTML named .pdf", bytes("<html><script>"), null],
    ["an empty file", bytes(), null],
  ] as const)("%s → %s", (_, input, expected) => {
    expect(detectFileKind(input)).toBe(expected);
  });
});
