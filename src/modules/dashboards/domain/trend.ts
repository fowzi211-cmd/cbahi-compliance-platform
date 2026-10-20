// The trend chart reads only snapshots (ARCHITECTURE §3.3): what was recorded each day,
// never a recomputation, so a later correction cannot rewrite the past.

export type TrendSeries = "internal" | "consultant";

export type TrendRow = { day: string; series: TrendSeries; score: number | null };

export type TrendPoint = { day: string; internal: number | null; consultant: number | null };

/**
 * One point per recorded day, oldest first, with both series side by side. A day with no
 * snapshot is simply absent (the worker was down): the chart joins its neighbours rather
 * than inventing a value.
 */
export function trendPoints(rows: readonly TrendRow[]): TrendPoint[] {
  const byDay = new Map<string, TrendPoint>();
  for (const row of rows) {
    const point = byDay.get(row.day) ?? { day: row.day, internal: null, consultant: null };
    point[row.series] = row.score;
    byDay.set(row.day, point);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The first day of a window of `days` days ending on `today` (inclusive). */
export function windowStart(today: string, days: number) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}
