"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MetricChart from "@/components/MetricChart";
import { Sample, compressSamples, getMetric, recentReadings } from "@/lib/metrics";
import { formatTime } from "@/lib/time";
import { Range, Stage } from "@/lib/annotations";

// How often to ask the server for anything newer than what's already on screen.
// Cheap enough at the handful of viewers this dashboard has that there's no
// reason to make it configurable.
const POLL_MS = 5000;
const RECENT_LIMIT = 5;

// One section per metric. Order here is render order; everything a section needs
// beyond the chart itself (the copy, which sensor to credit) lives in this one
// place instead of five near-identical JSX blocks.
const CHARTS = [
  { key: "co2", title: "CO₂ Concentration", subtitle: "Carbon dioxide concentration over time", sensor: "SCD30" },
  { key: "ethylene", title: "Ethylene Concentration", subtitle: "Ethylene concentration over time", sensor: "SPEC-C2H4" },
  { key: "temperature", title: "Temperature", subtitle: "Chamber temperature over time", sensor: "SHT31" },
  { key: "humidity", title: "Humidity", subtitle: "Relative humidity over time", sensor: "SHT31" },
  { key: "methane", title: "Methane Concentration", subtitle: "Methane concentration over time", sensor: "MQ4" },
] as const;

interface TableRow {
  time: string;
  value: string;
  sensor: string;
}

function RecentReadingsTable({ readings }: { readings: TableRow[] }) {
  return (
    <div className="recent-table">
      <div className="recent-table-header">
        <h3>Recent Readings</h3>
        <span>Last 5 measurements</span>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Value</th>
              <th>Sensor</th>
            </tr>
          </thead>

          <tbody>
            {readings.map((reading, index) => (
              <tr key={index}>
                <td>{reading.time}</td>
                <td className="reading-value">{reading.value}</td>
                <td>{reading.sensor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The charts and the recent-readings tables, kept current without a reload.
// Render once from the server-fetched samples, same as before; after that, poll
// for whatever's new and merge it in. Switching the viewed collection remounts
// this (the parent keys it by collection), so there's nothing to reset here.
export default function LiveDashboard({
  collection,
  initialSamples,
  annotation,
}: {
  collection: string;
  initialSamples: Sample[];
  annotation: { stages: Stage[]; ranges: Range[] };
}) {
  const [samples, setSamples] = useState<Sample[]>(initialSamples);

  // The cursor for the next poll. A ref, not state: it needs to be current
  // inside the interval's closure without retriggering the effect on every tick.
  const lastTsRef = useRef<number>(
    initialSamples.length ? initialSamples[initialSamples.length - 1].ts : 0
  );

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (document.hidden) return; // a backgrounded tab can wait for the next one

      try {
        const res = await fetch(
          `/api/data/live?view=${encodeURIComponent(collection)}&after=${lastTsRef.current}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;

        const { samples: fresh, latestTs } = await res.json();
        if (cancelled || !Array.isArray(fresh) || fresh.length === 0) return;

        setSamples((prev) => compressSamples([...prev, ...fresh]));
        if (typeof latestTs === "number") lastTsRef.current = latestTs;
      } catch {
        // dropped poll: the next tick picks up from the same cursor
      }
    }

    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [collection]);

  // Recomputed from whatever samples currently holds, so a poll that adds new
  // points updates these the same way it updates the charts.
  const tables = useMemo(() => {
    const byKey: Record<string, TableRow[]> = {};
    for (const chart of CHARTS) {
      const unit = getMetric(chart.key).unit;
      byKey[chart.key] = recentReadings(samples, chart.key, RECENT_LIMIT).map((r) => ({
        time: formatTime(r.ts),
        value: `${r.value} ${unit}`,
        sensor: chart.sensor,
      }));
    }
    return byKey;
  }, [samples]);

  return (
    <>
      {CHARTS.map((chart) => (
        <section className="chart-card" key={chart.key}>
          <div className="chart-header">
            <div>
              <h2>{chart.title}</h2>
              <p>{chart.subtitle}</p>
            </div>
          </div>

          <MetricChart annotations={annotation} data={samples} yKey={chart.key} />

          <RecentReadingsTable readings={tables[chart.key]} />
        </section>
      ))}
    </>
  );
}
