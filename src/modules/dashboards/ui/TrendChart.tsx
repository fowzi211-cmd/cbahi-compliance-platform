"use client";

import { useEffect, useRef, useState } from "react";

export type ChartPoint = {
  day: string;
  label: string;
  internal: number | null;
  consultant: number | null;
};

type SeriesKey = "internal" | "consultant";

const height = 220;
const pad = { top: 16, end: 16, bottom: 28, start: 44 };
const plotH = height - pad.top - pad.bottom;
// Arabic dates carry right-to-left marks that scramble them inside the left-to-right plot.
const plain = (label: string) => label.replace(/[\u200e\u200f\u061c]/g, "");
const gridLines = [0, 0.5, 1];

/**
 * Compliance over time from the nightly snapshots: the internal series and, once there is
 * one, the consultant's. One percentage axis; the readiness threshold is drawn so the gap
 * to "ready" is visible. Time runs left to right in both languages. Hovering or focusing
 * the chart shows the values of the nearest day; the same numbers are in the table below.
 */
export function TrendChart({
  points,
  threshold,
  labels,
}: {
  points: ChartPoint[];
  threshold: number;
  labels: { internal: string; consultant: string; threshold: string; chart: string };
}) {
  const [active, setActive] = useState<number | null>(null);
  // The drawing is sized to the box it sits in, so text stays legible on a phone instead of
  // shrinking with a fixed viewBox.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const plotW = width - pad.start - pad.end;
  const series: SeriesKey[] = points.some((p) => p.consultant !== null)
    ? ["internal", "consultant"]
    : ["internal"];
  const x = (i: number) =>
    pad.start + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + (1 - v) * plotH;
  const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

  const path = (key: SeriesKey) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const last = (key: SeriesKey) => {
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const v = points[i]![key];
      if (v !== null) return { i, v };
    }
    return null;
  };

  const nearest = (clientX: number, rect: DOMRect) => {
    const svgX = ((clientX - rect.left) / rect.width) * width;
    if (points.length === 1) return 0;
    const i = Math.round(((svgX - pad.start) / plotW) * (points.length - 1));
    return Math.min(points.length - 1, Math.max(0, i));
  };
  const shown = active === null ? null : points[active]!;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-hidden>
        {series.map((key) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 rounded-full"
              style={{ background: `var(--chart-${key})` }}
            />
            {labels[key]}
          </li>
        ))}
        <li className="text-muted-foreground flex items-center gap-2">
          <span className="border-muted-foreground inline-block w-5 border-t border-dashed" />
          {labels.threshold}
        </li>
      </ul>
      <div className="relative" dir="ltr" ref={box}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full touch-none"
          role="img"
          aria-label={labels.chart}
          tabIndex={0}
          onPointerMove={(event) =>
            setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))
          }
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(points.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? 0) - 1));
            if (event.key === "ArrowRight") {
              setActive((i) => Math.min(points.length - 1, (i ?? points.length - 1) + 1));
            }
          }}
        >
          {gridLines.map((g) => (
            <g key={g}>
              <line
                x1={pad.start}
                x2={width - pad.end}
                y1={y(g)}
                y2={y(g)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={pad.start - 8}
                y={y(g)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-xs"
              >
                {pct(g)}
              </text>
            </g>
          ))}
          <line
            x1={pad.start}
            x2={width - pad.end}
            y1={y(threshold)}
            y2={y(threshold)}
            className="stroke-muted-foreground"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          {points.length > 0 && (
            <>
              <text
                x={pad.start}
                y={height - 8}
                textAnchor="start"
                className="fill-muted-foreground text-xs"
              >
                {plain(points[0]!.label)}
              </text>
              {points.length > 1 && (
                <text
                  x={width - pad.end}
                  y={height - 8}
                  textAnchor="end"
                  className="fill-muted-foreground text-xs"
                >
                  {plain(points[points.length - 1]!.label)}
                </text>
              )}
            </>
          )}
          {series.map((key) => {
            const end = last(key);
            return (
              <g key={key} style={{ color: `var(--chart-${key})` }}>
                <path
                  d={path(key)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {end && (
                  <circle
                    cx={x(end.i)}
                    cy={y(end.v)}
                    r={4}
                    fill="currentColor"
                    className="stroke-card"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
          {shown && active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={pad.top}
                y2={pad.top + plotH}
                className="stroke-muted-foreground"
                strokeWidth={1}
              />
              {series.map((key) => {
                const v = shown[key];
                return v === null ? null : (
                  <circle
                    key={key}
                    cx={x(active)}
                    cy={y(v)}
                    r={4}
                    style={{ fill: `var(--chart-${key})` }}
                    className="stroke-card"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          )}
        </svg>
        {shown && active !== null && (
          <div
            className="border-border bg-card pointer-events-none absolute top-2 rounded-md border px-3 py-2 text-xs shadow-sm"
            style={
              x(active) > width / 2
                ? { right: `${((width - x(active)) / width) * 100 + 2}%` }
                : { left: `${(x(active) / width) * 100 + 2}%` }
            }
            role="status"
          >
            <div className="font-medium">{plain(shown.label)}</div>
            {series.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: `var(--chart-${key})` }}
                />
                <span dir="auto">{labels[key]}</span>
                <span className="ms-auto font-medium">{pct(shown[key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
