// A small RFC 4180 reader. Spreadsheet exports vary: Excel in Arabic or European locales
// often writes `;` instead of `,`, and adds a byte-order mark, so both are handled here.

export class CsvSyntaxError extends Error {
  constructor(readonly line: number) {
    super(`Unclosed quoted field starting on line ${line}`);
    this.name = "CsvSyntaxError";
  }
}

const candidates = [",", ";", "\t"] as const;

/** Picks the delimiter that occurs most often (outside quotes) in the header line. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(candidates.map((c) => [c, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best: string = ",";
  for (const c of candidates) if (counts.get(c)! > counts.get(best)!) best = c;
  return best;
}

/**
 * Parses CSV text into rows of fields. Each row carries the line it started on, so errors
 * can point at the line a person sees in their editor. Blank lines are skipped.
 */
export function parseCsv(input: string): { line: number; fields: string[] }[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endRow = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0] !== "") rows.push({ line: rowLine, fields });
    fields = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (quoted) throw new CsvSyntaxError(quoteLine);
  if (field !== "" || fields.length > 0) endRow();
  return rows;
}
