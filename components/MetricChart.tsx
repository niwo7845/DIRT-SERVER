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

const DAY = 24 * 3600;

const RANGES = [
  { label: "1D", seconds: DAY },
  { label: "1W", seconds: 7 * DAY },
  { label: "1M", seconds: 30 * DAY },
  { label: "ALL", seconds: null }, // null = everything
] as const;

type RangeLabel = (typeof RANGES)[number]["label"];

interface MetricChartProps {
  data: Sample[];
  yKey: string; // metric on the Y axis, e.g. "co2"
  xKey?: string; // metric on the X axis; defaults to "ts" (time)
  color?: string; // overrides the metric's default color
  connectPoints?: boolean; // draw a line between points (default: true only when X is time)
  maxPoints?: number; // visible window is averaged down to roughly this many points (default 1000)
  defaultRange?: RangeLabel; // initial time scale (default "ALL")
}

function formatTs(ts: number, includeDate: boolean): string {
  const date = new Date(ts * 1000);
  return includeDate
    ? date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Denver",
      })
    : date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Denver",
      });
}

// Neutral styling that works on light and dark backgrounds. Move into your CSS if you prefer.
function controlStyle(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: "4px 12px",
    borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.5)",
    background: active ? "rgba(128,128,128,0.25)" : "transparent",
    color: "inherit",
    fontWeight: active ? 700 : 400,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.35 : 1,
  };
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

  const includeDate = windowSize > DAY; // show the date once the window spans more than a day
  const dotRadius = points.length > 300 ? 2 : 3;

  const xDomain: [number | string, number | string] = isTime
    ? windowSize > 0
      ? [start, end]
      : ["dataMin", "dataMax"]
    : ["auto", "auto"];

  return (
    <div>
      <div style={{ width: "100%", height: 350 }}>
        <ScatterChart
          width={800}
          height={350}
          margin={{ top: 10, right: 30, left: 30, bottom: 30 }}
        >
          <CartesianGrid strokeDasharray="3 3" />

          {/* type="number" makes spacing proportional to the actual values */}
          <XAxis
            type="number"
            dataKey={xKey}
            name={xTitle}
            unit={!isTime && xInfo.unit ? ` ${xInfo.unit}` : undefined}
            domain={xDomain}
            tickFormatter={isTime ? (v: number) => formatTs(v, includeDate) : undefined}
            label={{
              value: xTitle,
              position: "insideBottom",
              offset: -5,
            }}
          />

          <YAxis
            type="number"
            dataKey={yKey}
            name={yTitle}
            unit={yInfo.unit ? ` ${yInfo.unit}` : undefined}
            domain={["auto", "auto"]}
            width={90}
            label={{
              value: yTitle,
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle" },
            }}
          />

          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value, name) => [
              isTime && name === xTitle ? formatTs(Number(value), includeDate) : value,
              name,
            ]}
          />

          <Scatter
            data={points}
            fill={lineColor}
            line={connect ? { stroke: lineColor, strokeWidth: 3 } : false}
            lineType="joint"
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => (
              <circle cx={props.cx} cy={props.cy} r={dotRadius} fill={lineColor} />
            )}
          />
        </ScatterChart>
      </div>

      <div
        className="chart-range-controls"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 8,
        }}
      >
        {canScroll && (
          <button
            type="button"
            className="chart-range-button"
            style={controlStyle(false, atStart)}
            onClick={scrollBack}
            disabled={atStart}
            aria-label="Scroll back"
          >
            ←
          </button>
        )}

        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            className="chart-range-button"
            style={controlStyle(r.label === range)}
            onClick={() => selectRange(r.label)}
          >
            {r.label}
          </button>
        ))}

        {canScroll && (
          <button
            type="button"
            className="chart-range-button"
            style={controlStyle(false, atLatest)}
            onClick={scrollForward}
            disabled={atLatest}
            aria-label="Scroll forward"
          >
            →
          </button>
        )}
      </div>

      {canScroll && (
        <p style={{ textAlign: "center", fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          {formatTs(start, true)} – {formatTs(end, true)}
        </p>
      )}
    </div>
  );
}