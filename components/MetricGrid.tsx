"use client";

import { ReactNode, useDeferredValue, useMemo, useState } from "react";
import MetricChart, { ChevronIcon, RANGES, RangeLabel } from "@/components/MetricChart";
import { Sample, METRICS, getMetric } from "@/lib/metrics";
import { rateUnit, sessionRates } from "@/lib/rates";
import { useLiveSamples } from "@/lib/useLiveSamples";
import { Range, Stage } from "@/lib/annotations";

// What each panel shows to begin with. Temperature is left out on purpose: it's
// one pick away in any panel's header.
const DEFAULT_PANELS = ["co2", "ethylene", "humidity", "methane"];

// Every metric the app knows about, in registry order.
const METRIC_KEYS = Object.keys(METRICS);

type Mode = "raw" | "rate";

const MODES: { mode: Mode; label: string; title: string }[] = [
  { mode: "raw", label: "Raw", title: "Every reading" },
  { mode: "rate", label: "Rate", title: "Average rate of change per session" },
];

// All the charts at once, side by side, on one shared time scale. Owns the one
// copy of the samples for its page and keeps it live.
export default function MetricGrid({
  collection,
  initialSamples,
  annotation,
  heading,
}: {
  collection: string;
  initialSamples: Sample[];
  annotation: { stages: Stage[]; ranges: Range[] };
  heading?: ReactNode; // replaces the default title block
}) {
  const samples = useLiveSamples(collection, initialSamples);
  const [range, setRange] = useState<RangeLabel>("1D");
  const [windowEnd, setWindowEnd] = useState<number | null>(null); // null = pinned to the latest data
  const [panels, setPanels] = useState<string[]>(DEFAULT_PANELS);
  const [mode, setMode] = useState<Mode>("raw");

  // The controls above act on the values just set; the charts draw from this
  // deferred copy, which trails behind while React works through the (heavy)
  // chart renders. Until it catches up, `pending` puts "Loading…" over the charts
  // instead of leaving the old ones on screen as if nothing had happened.
  const view = useMemo(() => ({ mode, range, windowEnd, panels }), [mode, range, windowEnd, panels]);
  const shown = useDeferredValue(view);
  const pending = shown !== view;

  // What each panel plots. In rate mode that's one point per session, worked out
  // here in the browser from the samples it already holds, so it moves with every
  // poll like the raw charts do.
  const panelData = useMemo(
    () => shown.panels.map((metric) => (shown.mode === "rate" ? sessionRates(samples, metric) : samples)),
    [samples, shown.mode, shown.panels]
  );

  // The scroll position is shared like the range, so it's worked out here from
  // what is being plotted, the same way each chart does for its own metric.
  const { dataMin, dataMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const points of shown.mode === "rate" ? panelData : [samples]) {
      for (const s of points) {
        if (s.ts < min) min = s.ts;
        if (s.ts > max) max = s.ts;
      }
    }
    return min <= max ? { dataMin: min, dataMax: max } : { dataMin: 0, dataMax: 0 };
  }, [samples, panelData, shown.mode]);

  const totalSpan = dataMax - dataMin;
  const rangeSeconds = RANGES.find((r) => r.label === shown.range)!.seconds;
  const windowSize = rangeSeconds === null ? totalSpan : Math.min(rangeSeconds, totalSpan);
  const canScroll = totalSpan > windowSize;
  const end =
    canScroll && shown.windowEnd !== null
      ? Math.min(Math.max(shown.windowEnd, dataMin + windowSize), dataMax)
      : dataMax;
  const atStart = end - windowSize <= dataMin;
  const atLatest = end >= dataMax;

  function selectRange(next: RangeLabel) {
    setRange(next);
    setWindowEnd(null); // jump back to the latest data
  }

  function scrollBack() {
    setWindowEnd(Math.max(end - windowSize / 2, dataMin + windowSize));
  }

  function scrollForward() {
    const next = end + windowSize / 2;
    setWindowEnd(next >= dataMax ? null : next);
  }

  function setPanel(index: number, metric: string) {
    setPanels((prev) => prev.map((m, i) => (i === index ? metric : m)));
  }

  return (
    <section className="chart-card grid-card">
      <div className="grid-card-header">
        {heading ? (
          <div>{heading}</div>
        ) : (
          <div>
            <h2>Dashboard</h2>
            <p>Live overview of every sensor</p>
          </div>
        )}

        <div className="grid-card-controls">
          <div className="chart-range-group" role="group" aria-label="Data shown in all charts">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                className="chart-range-button"
                aria-pressed={m.mode === mode}
                title={m.title}
                onClick={() => setMode(m.mode)}
              >
                {m.label}
              </button>
            ))}
          </div>

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

            <div className="chart-range-group" role="group" aria-label="Time scale for all charts">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className="chart-range-button"
                  aria-pressed={r.label === range}
                  aria-label={r.title}
                  title={r.title}
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
      </div>

      <div className="metric-grid">
        {panels.map((metric, index) => (
          <div className="metric-grid-panel" key={index}>
            <select
              className="metric-grid-select"
              value={metric}
              onChange={(e) => setPanel(index, e.target.value)}
              aria-label={`Metric for panel ${index + 1}`}
            >
              {METRIC_KEYS.map((key) => (
                <option key={key} value={key}>
                  {getMetric(key).label} ({mode === "rate" ? rateUnit(key) : getMetric(key).unit})
                </option>
              ))}
            </select>

            <MetricChart
              annotations={annotation}
              data={panelData[index] ?? samples}
              yKey={shown.panels[index]}
              yLabel={shown.mode === "rate" ? `${getMetric(shown.panels[index]).label} rate` : undefined}
              yUnit={shown.mode === "rate" ? rateUnit(shown.panels[index]) : undefined}
              range={shown.range}
              windowEnd={shown.windowEnd}
              height="100%"
            />

            {pending ? (
              <div className="metric-grid-overlay" role="status">Loading…</div>
            ) : shown.mode === "rate" && panelData[index]?.length === 0 ? (
              <div className="metric-grid-overlay">No sessions recorded yet</div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
