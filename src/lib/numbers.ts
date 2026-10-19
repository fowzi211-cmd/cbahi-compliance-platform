// Numbers shown to people. Latin digits in both languages (ARCHITECTURE §7), so they are
// built here rather than by locale-aware formatting.

/** A fraction (0..1) as a whole percentage, e.g. 0.756 → "76%". */
export function formatPercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
