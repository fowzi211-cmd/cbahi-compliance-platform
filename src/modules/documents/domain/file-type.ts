// What may be uploaded, decided from the file's own bytes: the browser's MIME type and the
// file name are claims, not facts.

export const fileKinds = ["pdf", "docx", "xlsx", "png", "jpeg"] as const;
export type FileKind = (typeof fileKinds)[number];

export const contentTypes: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpeg: "image/jpeg",
};

/** The kinds whose text the server extracts and scans for PHI. */
export const scannableKinds: readonly FileKind[] = ["pdf", "docx"];

export const maxUploadBytes = 10 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((b, i) => bytes[i] === b);

/** True when the ASCII text appears anywhere in the bytes (a zip's entry names are plain). */
function contains(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The kind of file, or null for anything not on the list. */
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // Office files are zip archives; the entry names say which application wrote them.
    if (contains(bytes, "word/document.xml")) return "docx";
    if (contains(bytes, "xl/workbook.xml")) return "xlsx";
  }
  return null;
}
