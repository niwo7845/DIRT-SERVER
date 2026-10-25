"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceArea,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useXAxisInverseScale,
} from "recharts";
import { Sample, getMetric, averageSamples } from "@/lib/metrics";
import { TIME_ZONE, zoneOffset } from "@/lib/time";
import { Range, Stage, findStage, sortedRanges } from "@/lib/annotations";

const HOUR = 3600;
const DAY = 24 * HOUR;

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

const TOOLTIP_CURSOR = { stroke: "#94a3b8", strokeDasharray: "3 3" };
const TOOLTIP_STYLE = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  boxShadow: "0 6px 20px rgba(15, 23, 42, 0.08)",
  fontSize: 13,
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
const hourFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: TIME_ZONE });

interface MetricChartProps {
  data: Sample[];
  yKey: string; // metric on the Y axis, e.g. "co2"
  xKey?: string; // metric on the X axis; defaults to "ts" (time)
  color?: string; // overrides the metric's default color
  connectPoints?: boolean; // draw a line between points (default: true only when X is time)
  maxPoints?: number; // visible window is averaged down to roughly this many points (default 1000)
  defaultRange?: RangeLabel; // initial time scale (default "ALL")
  annotations?: { stages: Stage[]; ranges: Range[] }; // shade the stages behind the data
  separators?: number[]; // stage boundaries to draw as draggable vertical bars
  separatorColors?: string[]; // stage colour starting at each boundary
  clampSeparator?: (index: number, ts: number) => number;
  onMoveSeparator?: (index: number, ts: number) => void;
  tentative?: boolean; // the bands are only a suggested split, not saved
}

// Fraction of the window a band must cover before its name is drawn inside it,
// so narrow bands don't pile labels on top of each other.
const BAND_LABEL_MIN_SHARE = 0.12;

// Full label for tooltips and the window caption, e.g. "Oct 24, 3:38 PM"
function formatTs(ts: number): string {
  const date = new Date(ts * 1000);
  return `${dateFormat.format(date)}, ${timeFormat.format(date)}`;
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

// The separators between stages, draggable. This lives *inside* the chart so it can
// use recharts' own plot area and x scale rather than guessing at axis widths.
// Positions are fully controlled: a drag reports a timestamp and the parent, which
// knows the neighbouring separators, decides where it may actually land.
function BoundaryHandles({
  values,
  colors,
  dashed,
  clamp,
  onMove,
}: {
  values: number[];
  colors: string[]; // colors[i] is the stage that starts at values[i]
  dashed: boolean;
  clamp: (index: number, ts: number) => number;
  onMove: (index: number, ts: number) => void;
}) {
  const plotArea = usePlotArea();
  const scale = useXAxisScale();
  const inverseScale = useXAxisInverseScale();

  // The in-progress drag is held HERE rather than lifted to the parent, so moving a
  // separator re-renders these few lines instead of the whole chart. The parent is
  // told once, on drop. Without this, every pointermove re-rendered all the data
  // points, which is what made dragging feel heavy.
  const [drag, setDrag] = useState<{ index: number; ts: number } | null>(null);

  if (!plotArea || !scale || !inverseScale) return null;

  const left = plotArea.x;
  const right = plotArea.x + plotArea.width;
  const bottom = plotArea.y + plotArea.height;

  // Pinned to locals: a hoisted function declaration can't rely on the guard above.
  const toPixel = scale;
  const toValue = inverseScale;

  // Where the pointer is, as a timestamp snapped to the minute (all the
  // datetime-local inputs can express, so the two stay in agreement).
  function pointerTs(e: React.PointerEvent<SVGRectElement>, index: number): number {
    const svg = e.currentTarget.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return NaN;

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const x = Math.min(Math.max(point.matrixTransform(matrix.inverse()).x, left), right);

    return clamp(index, Math.round(Number(toValue(x)) / 60) * 60);
  }

  const positionOf = (index: number) =>
    drag && drag.index === index ? drag.ts : values[index];

  // While a separator is being dragged, shade the ground it is taking, in the
  // colour of whichever stage is gaining it. Two rects, so it stays cheap.
  let preview: { x: number; width: number; fill: string } | null = null;
  if (drag) {
    const fromX = Number(toPixel(values[drag.index]));
    const toX = Number(toPixel(drag.ts));
    const gainingIndex = drag.ts > values[drag.index] ? drag.index - 1 : drag.index;
    const fill = colors[gainingIndex];

    if (Number.isFinite(fromX) && Number.isFinite(toX) && fill && Math.abs(toX - fromX) > 0.5) {
      preview = { x: Math.min(fromX, toX), width: Math.abs(toX - fromX), fill };
    }
  }

  return (
    <g>
      {preview && (
        <rect
          x={preview.x}
          y={plotArea.y}
          width={preview.width}
          height={plotArea.height}
          fill={preview.fill}
          fillOpacity={0.3}
          style={{ pointerEvents: "none" }}
        />
      )}

      {values.map((_, index) => {
        const x = Number(toPixel(positionOf(index)));
        if (!Number.isFinite(x) || x < left - 1 || x > right + 1) return null;

        const active = drag?.index === index;

        return (
          <g key={index}>
            <line
              x1={x}
              x2={x}
              y1={plotArea.y}
              y2={bottom}
              className={`chart-boundary${active ? " chart-boundary-active" : ""}`}
              strokeDasharray={dashed && !active ? "4 4" : undefined}
            />

            {/* Grip, drawn mid-height so there is something obvious to grab. */}
            <rect
              x={x - 3}
              y={plotArea.y + plotArea.height / 2 - 11}
              width={6}
              height={22}
              rx={3}
              className={`chart-boundary-grip${active ? " chart-boundary-active" : ""}`}
              style={{ pointerEvents: "none" }}
            />

            {/* Wider than the line so it can actually be grabbed. */}
            <rect
              x={x - 8}
              y={plotArea.y}
              width={16}
              height={plotArea.height}
              fill="transparent"
              style={{ cursor: "ew-resize", touchAction: "none" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ index, ts: values[index] });
              }}
              onPointerMove={(e) => {
                if (drag?.index !== index) return;
                const next = pointerTs(e, index);
                if (Number.isFinite(next)) setDrag({ index, ts: next });
              }}
              onPointerUp={() => {
                if (drag?.index === index && drag.ts !== values[index]) {
                  onMove(index, drag.ts); // the one update the parent sees
                }
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
            />
          </g>
        );
      })}
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
  annotations,
  separators,
  separatorColors,
  clampSeparator,
  onMoveSeparator,
  tentative = false,
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

  // Stage bands clipped to the visible window; ranges entirely outside it are dropped.
  const bands = useMemo(() => {
    if (!annotations || !isTime || windowSize <= 0) return [];

    return sortedRanges(annotations.ranges).flatMap((range) => {
      const stage = findStage(annotations.stages, range.stageId);
      if (!stage) return [];

      const from = Math.max(range.startTs, start);
      const to = Math.min(range.endTs ?? end, end);
      if (to <= from) return [];

      return [{ key: `${range.stageId}-${range.startTs}`, stage, from, to }];
    });
  }, [annotations, isTime, windowSize, start, end]);

  // Only the stages actually used by a range, in the order they happen.
  const legendStages = useMemo(
    () =>
      annotations
        ? annotations.stages.filter((stage) =>
            annotations.ranges.some((range) => range.stageId === stage.id)
          )
        : [],
    [annotations]
  );

  const dotRadius = points.length > 300 ? 2 : 3;
  // Both walk the clock through Intl.formatToParts, which is slow enough to be
  // worth not redoing whenever an unrelated piece of state changes.
  const { ticks, step } = useMemo(() => timeTicks(start, end), [start, end]);
  const midnights = useMemo(
    () => (isTime && windowSize > 0 ? dayLines(start, end) : []),
    [isTime, windowSize, start, end]
  );

  // Recharts re-renders every data point when these change identity, so they are
  // memoised: a chart with hundreds of points is otherwise re-drawn on any render.
  const renderDot = useCallback(
    (props: { cx?: number; cy?: number }) => (
      <circle cx={props.cx} cy={props.cy} r={dotRadius} fill={lineColor} />
    ),
    [dotRadius, lineColor]
  );

  const lineStyle = useMemo<{ stroke: string; strokeWidth: number } | false>(
    () => (connect ? { stroke: lineColor, strokeWidth: 2.5 } : false),
    [connect, lineColor]
  );

  const tooltipFormatter = useCallback(
    (value: unknown, name: unknown) => [
      isTime && name === xTitle ? formatTs(Number(value)) : (value as number | string),
      name as string,
    ] as [number | string, string],
    [isTime, xTitle]
  );

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

        {/* Before <Scatter> and at the default layer, so bands sit behind the data.
            ifOverflow is explicit: recharts would otherwise discard a clipped band. */}
        {bands.map((band) => (
          <ReferenceArea
            key={band.key}
            x1={band.from}
            x2={band.to}
            fill={band.stage.color}
            fillOpacity={tentative ? 0.08 : 0.16}
            stroke="none"
            ifOverflow="hidden"
            zIndex={0}
            label={
              band.to - band.from > (end - start) * BAND_LABEL_MIN_SHARE
                ? {
                    value: band.stage.name,
                    position: "insideTop",
                    fill: band.stage.color,
                    fontSize: 11,
                    fontWeight: 700,
                  }
                : undefined
            }
          />
        ))}

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
          cursor={TOOLTIP_CURSOR}
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipFormatter}
        />

        <Scatter
          data={points}
          fill={lineColor}
          line={lineStyle}
          lineType="joint"
          isAnimationActive={false}
          shape={renderDot}
        />

        {/* Last child, so the grab strips sit above the data. */}
        {separators && onMoveSeparator && clampSeparator && isTime && windowSize > 0 && (
          <BoundaryHandles
            values={separators}
            colors={separatorColors ?? []}
            dashed={tentative}
            clamp={clampSeparator}
            onMove={onMoveSeparator}
          />
        )}
      </ScatterChart>

      {legendStages.length > 0 && (
        <div className="annotation-legend">
          {legendStages.map((stage) => (
            <span key={stage.id} className="annotation-legend-item">
              <span
                className="annotation-legend-swatch"
                style={{ background: stage.color }}
                aria-hidden="true"
              />
              {stage.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
