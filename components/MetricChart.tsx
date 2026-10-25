"use client";

import { useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Sample, getMetric, averageSamples } from "@/lib/metrics";

const HOUR = 3600;
const DAY = 24 * HOUR;
const TIME_ZONE = "America/Denver";

const RANGES = [
  { label: "1D", seconds: DAY },
  { label: "1W", seconds: 7 * DAY },
  { label: "1M", seconds: 30 * DAY },
  { label: "ALL", seconds: null }, // null = everything
] as const;

type RangeLabel = (typeof RANGES)[number]["label"];

// Candidate spacings between time ticks, smallest first.
const TICK_STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY];
const MAX_TICKS = 7;

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
const hourFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: TIME_ZONE });
const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface MetricChartProps {
  data: Sample[];
  yKey: string; // metric on the Y axis, e.g. "co2"
  xKey?: string; // metric on the X axis; defaults to "ts" (time)
  color?: string; // overrides the metric's default color
  connectPoints?: boolean; // draw a line between points (default: true only when X is time)
  maxPoints?: number; // visible window is averaged down to roughly this many points (default 1000)
  defaultRange?: RangeLabel; // initial time scale (default "ALL")
}

// Full label for tooltips and the window caption, e.g. "Oct 24, 3:38 PM"
function formatTs(ts: number): string {
  const date = new Date(ts * 1000);
  return `${dateFormat.format(date)}, ${timeFormat.format(date)}`;
}

// Seconds to add to a UTC timestamp to get Denver wall-clock time (handles DST).
function zoneOffset(ts: number): number {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(new Date(ts * 1000)).map((p) => [p.type, Number(p.value)])
  );
  const wall =
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 1000;
  return wall - Math.floor(ts);
}

// Evenly spaced ticks on round local hours/days, so labels stay short.
function timeTicks(start: number, end: number): { ticks: number[]; step: number } {
  const span = end - start;
  const step =
    TICK_STEPS.find((s) => span / s <= MAX_TICKS) ?? Math.ceil(span / MAX_TICKS / DAY) * DAY;
  const offset = zoneOffset(start);
  const ticks: number[] = [];
  for (let t = Math.ceil((start + offset) / step) * step - offset; t <= end; t += step) {
    ticks.push(t);
  }
  return { ticks, step };
}

// Local midnights inside [start, end], thinned to every few days for long windows.
function dayLines(start: number, end: number): number[] {
  const days = (end - start) / DAY;
  const every = days <= 14 ? 1 : days <= 30 ? 2 : days <= 45 ? 3 : Math.ceil(days / 15);

  const lines: number[] = [];
  let t = Math.ceil((start + zoneOffset(start)) / DAY) * DAY - zoneOffset(start);
  for (let i = 0; t <= end; i++) {
    if (i % every === 0) lines.push(t);
    // Step a day in local time, re-snapping to midnight across DST changes
    const next = t + DAY;
    t = Math.round((next + zoneOffset(next)) / DAY) * DAY - zoneOffset(next);
  }
  return lines;
}

// Hour on top; the date underneath only on the first tick of each day.
// Once ticks are a day or more apart, just the date.
function TimeTick({
  x,
  y,
  payload,
  index,
  ticks,
  step,
}: {
  x?: number;
  y?: number;
  payload?: { value: number };
  index?: number;
  ticks: number[];
  step: number;
}) {
  if (x === undefined || y === undefined || !payload) return null;
  const date = new Date(payload.value * 1000);
  const prev = index ? ticks[index - 1] : undefined;
  const newDay =
    prev === undefined || dateFormat.format(new Date(prev * 1000)) !== dateFormat.format(date);

  const top = step >= DAY ? dateFormat.format(date) : hourFormat.format(date);
  const bottom = step < DAY && newDay ? dateFormat.format(date) : null;

  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={14} textAnchor="middle" className="chart-tick">
        {top}
      </text>
      {bottom && (
        <text dy={30} textAnchor="middle" className="chart-tick chart-tick-date">
          {bottom}
        </text>
      )}
    </g>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={direction === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MetricChart({
  data,
  yKey,
  xKey = "ts",
  color,
  connectPoints,
  maxPoints = 1000,
  defaultRange = "ALL",
}: MetricChartProps) {
  const [range, setRange] = useState<RangeLabel>(defaultRange);
  const [windowEnd, setWindowEnd] = useState<number | null>(null); // null = pinned to the latest data

  const isTime = xKey === "ts";
  const connect = connectPoints ?? isTime;

  const yInfo = getMetric(yKey);
  const xInfo = isTime ? { label: "Time", unit: "" } : getMetric(xKey);
  const lineColor = color ?? yInfo.color;

  const xTitle = xInfo.unit ? `${xInfo.label} (${xInfo.unit})` : xInfo.label;
  const yTitle = yInfo.unit ? `${yInfo.label} (${yInfo.unit})` : yInfo.label;

  // Oldest-first, only samples that actually have both values for this chart
  const sorted = useMemo(
    () =>
      data
        .filter((s) => Number.isFinite(s[xKey]) && Number.isFinite(s[yKey]))
        .sort((a, b) => a.ts - b.ts),
    [data, xKey, yKey]
  );

  // ---- time window math ----
  const dataMin = sorted.length ? sorted[0].ts : 0;
  const dataMax = sorted.length ? sorted[sorted.length - 1].ts : 0;
  const totalSpan = dataMax - dataMin;

  const rangeSeconds = RANGES.find((r) => r.label === range)!.seconds;
  const windowSize = rangeSeconds === null ? totalSpan : Math.min(rangeSeconds, totalSpan);
  const canScroll = totalSpan > windowSize; // some data is outside the current window

  // Keep the window inside the data (also handles data changing after a refresh)
  const end =
    canScroll && windowEnd !== null
      ? Math.min(Math.max(windowEnd, dataMin + windowSize), dataMax)
      : dataMax;
  const start = end - windowSize;
  const atStart = start <= dataMin;
  const atLatest = end >= dataMax;

  function selectRange(label: RangeLabel) {
    setRange(label);
    setWindowEnd(null); // jump back to the latest data
  }

  function scrollBack() {
    setWindowEnd(Math.max(end - windowSize / 2, dataMin + windowSize)); // back by 50% of the window
  }

  function scrollForward() {
    const next = end + windowSize / 2;
    setWindowEnd(next >= dataMax ? null : next);
  }

  // Samples inside the window, averaged down to maxPoints so rendering stays fast
  const points = useMemo(() => {
    const visible = sorted.filter((s) => s.ts >= start && s.ts <= end);
    return averageSamples(visible, Math.ceil(visible.length / maxPoints));
  }, [sorted, start, end, maxPoints]);

  const dotRadius = points.length > 300 ? 2 : 3;
  const { ticks, step } = timeTicks(start, end);
  const midnights = isTime && windowSize > 0 ? dayLines(start, end) : [];

  const xDomain: [number | string, number | string] = isTime
    ? windowSize > 0
      ? [start, end]
      : ["dataMin", "dataMax"]
    : ["auto", "auto"];

  return (
    <div className="metric-chart">
      <div className="chart-toolbar">
        <span className="chart-window">
          {sorted.length ? `${formatTs(start)} – ${formatTs(end)}` : "No data yet"}
        </span>

        <div className="chart-range-controls">
          {canScroll && (
            <button
              type="button"
              className="chart-nav-button"
              onClick={scrollBack}
              disabled={atStart}
              aria-label="Scroll back"
            >
              <ChevronIcon direction="left" />
            </button>
          )}

          <div className="chart-range-group" role="group" aria-label="Time scale">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                className="chart-range-button"
                aria-pressed={r.label === range}
                onClick={() => selectRange(r.label)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {canScroll && (
            <button
              type="button"
              className="chart-nav-button"
              onClick={scrollForward}
              disabled={atLatest}
              aria-label="Scroll forward"
            >
              <ChevronIcon direction="right" />
            </button>
          )}
        </div>
      </div>

      <ScatterChart
        responsive
        className="chart-plot"
        style={{ width: "100%", height: 320 }}
        margin={{ top: 10, right: 16, left: 4, bottom: isTime ? 4 : 24 }}
      >
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        {midnights.length > 0 && (
          <CartesianGrid stroke="#e2e8f0" horizontal={false} verticalValues={midnights} />
        )}

        {/* type="number" makes spacing proportional to the actual values */}
        <XAxis
          type="number"
          dataKey={xKey}
          name={xTitle}
          unit={!isTime && xInfo.unit ? ` ${xInfo.unit}` : undefined}
          domain={xDomain}
          ticks={isTime && windowSize > 0 ? ticks : undefined}
          tick={isTime ? <TimeTick ticks={ticks} step={step} /> : { fill: "#64748b", fontSize: 12 }}
          interval={0}
          height={isTime ? 40 : 30}
          stroke="#cbd5e1"
          tickLine={false}
          label={
            isTime
              ? undefined
              : { value: xTitle, position: "insideBottom", offset: -16, className: "chart-axis-label" }
          }
        />

        <YAxis
          type="number"
          dataKey={yKey}
          name={yTitle}
          unit={yInfo.unit ? ` ${yInfo.unit}` : undefined}
          domain={["auto", "auto"]}
          width={80}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#64748b", fontSize: 12 }}
          label={{
            value: yTitle,
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
            className: "chart-axis-label",
          }}
        />

        <Tooltip
          cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
          contentStyle={{
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            boxShadow: "0 6px 20px rgba(15, 23, 42, 0.08)",
            fontSize: 13,
          }}
          formatter={(value, name) => [
            isTime && name === xTitle ? formatTs(Number(value)) : value,
            name,
          ]}
        />

        <Scatter
          data={points}
          fill={lineColor}
          line={connect ? { stroke: lineColor, strokeWidth: 2.5 } : false}
          lineType="joint"
          isAnimationActive={false}
          shape={(props: { cx?: number; cy?: number }) => (
            <circle cx={props.cx} cy={props.cy} r={dotRadius} fill={lineColor} />
          )}
        />
      </ScatterChart>
    </div>
  );
}
