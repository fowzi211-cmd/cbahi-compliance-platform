import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { FileKind } from "./domain/file-type";

// Text for the PHI scan. Only PDF and Word files are read; the text is used for the scan
// and then dropped, never stored or logged.

/** The file's text, or null when this kind is not scanned or the file cannot be read. */
export async function extractText(kind: FileKind, bytes: Uint8Array): Promise<string | null> {
  try {
    if (kind === "pdf") {
      // unpdf may detach the buffer it is given, so it gets a copy.
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return text;
    }
    if (kind === "docx") {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return value;
    }
    return null;
  } catch {
    return null;
  }
}
