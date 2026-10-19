// Coercion of spreadsheet cells. XLSX gives numbers and booleans, CSV gives strings, JSON
// gives either, so every reader goes through these before validation.

export type Cell = string | number | boolean | null | undefined | readonly unknown[];

const arabicIndic = /[٠-٩۰-۹]/g;

/** Arabic-Indic and Persian digits to Latin, and the Arabic decimal separator to a dot. */
export function latinDigits(value: string): string {
  return value.replace(arabicIndic, (d) => String((d.charCodeAt(0) & 0xf) % 10)).replace(/٫/g, ".");
}

/** Trimmed text, or null when empty. Line breaks inside a cell are kept. */
export function textCell(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  if (Array.isArray(cell)) return cell.length ? cell.map(String).join(", ") : null;
  const value = String(cell).trim();
  return value === "" ? null : value;
}

const truthy = new Set(["true", "yes", "y", "1", "نعم", "x", "✓"]);
const falsy = new Set(["false", "no", "n", "0", "لا"]);

/** A yes/no cell. Empty means `fallback`; anything unrecognised is `undefined` (invalid). */
export function booleanCell(cell: Cell, fallback: boolean): boolean | undefined {
  if (typeof cell === "boolean") return cell;
  const value = textCell(cell);
  if (value === null) return fallback;
  const key = latinDigits(value).toLowerCase();
  if (truthy.has(key)) return true;
  if (falsy.has(key)) return false;
  return undefined;
}

/** A number cell. Empty means `fallback`; anything unparseable is `undefined` (invalid). */
export function numberCell(cell: Cell, fallback: number): number | undefined {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : undefined;
  const value = textCell(cell);
  if (value === null) return fallback;
  const normalized = latinDigits(value);
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
  return Number(normalized);
}

/** A list cell: an array, or text separated by `|`, `,`, `;` or the Arabic comma. */
export function listCell(cell: Cell): string[] {
  const parts = Array.isArray(cell)
    ? cell.map((v) => String(v))
    : (textCell(cell) ?? "").split(/[|,;،]/);
  const values = parts.map((p) => p.trim().toLowerCase()).filter((p) => p !== "");
  return [...new Set(values)];
}
