import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

// PDFs are HTML printed by headless Chromium (ARCHITECTURE §1): it shapes Arabic, applies
// the bidi algorithm and embeds the fonts correctly, which most JS PDF libraries do not.
// The page is printed with JavaScript off and every network request refused, so a report
// can only show what is in its HTML.

const fontDir = () =>
  path.join(process.cwd(), "node_modules", "@fontsource", "ibm-plex-sans-arabic");
const fontWeights = [400, 700] as const;
const fontSubsets = ["arabic", "latin"] as const;

let fontCss: Promise<string> | undefined;

/**
 * `@font-face` rules for IBM Plex Sans Arabic (the app's own font), with the files inlined as
 * data URIs. Read once per process. Empty when the font package is missing, in which case
 * Chromium falls back to a system font.
 */
export function pdfFontCss(): Promise<string> {
  fontCss ??= (async () => {
    const rules: string[] = [];
    for (const weight of fontWeights) {
      let css: string;
      try {
        css = await readFile(path.join(fontDir(), `${weight}.css`), "utf8");
      } catch {
        return "";
      }
      for (const subset of fontSubsets) {
        const file = `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`;
        const block = css.split("@font-face").find((b) => b.includes(file));
        const range = block?.match(/unicode-range:\s*([^;]+);/)?.[1];
        const bytes = await readFile(path.join(fontDir(), "files", file));
        rules.push(
          `@font-face{font-family:"Report";font-style:normal;font-weight:${weight};` +
            `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2");` +
            (range ? `unicode-range:${range};` : "") +
            "}",
        );
      }
    }
    return rules.join("\n");
  })();
  return fontCss;
}

export type PdfPage = {
  html: string;
  // Printed at the foot of every page. Chromium fills `.pageNumber` and `.totalPages`.
  footerHtml: string;
};

/** Prints each HTML page to an A4 PDF, in order, with one browser. */
export async function renderPdfs(pages: readonly PdfPage[]): Promise<Uint8Array[]> {
  if (env().PDF_RENDERER === "fake") return pages.map((p) => fakePdf(p.html));
  const { chromium } = await import("playwright-core");
  const executablePath = env().PDF_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route("**/*", (route) => route.abort());
    const results: Uint8Array[] = [];
    for (const page of pages) {
      const tab = await context.newPage();
      await tab.setContent(page.html, { waitUntil: "load" });
      const pdf = await tab.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: page.footerHtml,
        margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
      });
      results.push(new Uint8Array(pdf));
      await tab.close();
    }
    return results;
  } finally {
    await browser.close();
  }
}

/**
 * A small but valid PDF holding the page's text, for tests that run without a browser.
 * Only printable ASCII survives (so Arabic is dropped), which is enough to check that the
 * PHI scan reads the report. Text is wrapped and paged: a PDF reader drops what falls off
 * the page.
 */
export function fakePdf(html: string): Uint8Array {
  const words = html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#39;/g, " ")
    .replace(/[^\x20-\x7e]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + word.length < 100)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const perPage = 80;
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage)
    pages.push(lines.slice(i, i + perPage));

  const escape = (line: string) => line.replace(/[\\()]/g, (c) => `\\${c}`);
  // Objects: 1 catalog, 2 pages, 3 font, then a page and its content stream per page.
  const pageRef = (i: number) => 4 + i * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageRef(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((page, i) => {
    const stream = [
      "BT /F1 8 Tf 10 TL 20 810 Td",
      ...page.map((l) => `(${escape(l)}) '`),
      "ET",
    ].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pageRef(i) + 1} 0 R ` +
        "/Resources << /Font << /F1 3 0 R >> >> >>",
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
