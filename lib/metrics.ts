// One flat sample = one timestamp plus any number of metric values.
// e.g. { ts: 1790390056, co2: 900, temperature: 77, humidity: 48, methane: 100 }
//
// sessionId says which start/stop window the reading was taken in; it is absent
// for readings outside any session. It is the one non-numeric field.
export interface Sample {
  ts: number; // unix seconds
  sessionId?: string;
  [metric: string]: number | string | undefined;
}

export interface MetricInfo {
  label: string;
  unit: string;
  color: string;
}

export const COMPRESS_THRESHOLD = 8000; // compress once there are more samples than this
export const KEEP_RECENT_FULL_RES = 2000; // newest samples are never averaged
// ==================== EDIT THESE ====================
// Keys must match the "metric" names your ESP32 sends.
export const METRICS: Record<string, MetricInfo> = {
  co2: { label: "CO₂", unit: "ppm", color: "#22c55e" },
  ethylene: { label: "Ethylene", unit: "ppm", color: "#f59e0b" },
  methane: { label: "Methane", unit: "ppm", color: "#ef4444" },
  temperature: { label: "Temperature", unit: "°C", color: "#3b82f6" }, // the ESP32 sends Celsius
  humidity: { label: "Humidity", unit: "%", color: "#8b5cf6" },
};
// =====================================================

// Unknown metrics still work; they just get a generic label and color.
export function getMetric(key: string): MetricInfo {
  return METRICS[key] ?? { label: key, unit: "", color: "#64748b" };
}

// A stored sample's readings, in either shape the database holds.
//
//   current: { co2: 1151, temperature: 18.94, humidity: 43.86 }
//   older:   [{ metric: "co2", value: 1151, unit: "ppm" }, ...]
//
// The unit is a property of the metric, not of each reading, so it is no longer
// stored — getMetric(metric).unit is the single source of it. Both shapes appear
// in the database until the older documents are migrated, so everything that
// reads a sample goes through here.
//
// Null means this isn't a shape we recognise, which the caller treats as a
// payload to pass through untouched rather than a sample with no readings.
export function readingsOf(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const readings: Record<string, unknown> = {};
    for (const entry of data) {
      const reading = entry as { metric?: unknown; value?: unknown };
      if (reading && typeof reading === "object" && typeof reading.metric === "string") {
        readings[reading.metric] = reading.value;
      }
    }
    return readings;
  }

  if (data && typeof data === "object") return { ...(data as Record<string, unknown>) };
  return null;
}

// The most recent readings of one metric, newest first — what the dashboard's
// "Recent Readings" tables show. `samples` must be oldest-first, as every list
// of them in this app is, so this walks from the end rather than sorting.
//
// Reads off whatever the chart is already holding client-side rather than a
// separate query, so a live-updating dashboard can recompute a table the moment
// new samples arrive instead of asking the server for it again.
export function recentReadings(
  samples: Sample[],
  metric: string,
  limit: number
): { ts: number; value: number }[] {
  const rows: { ts: number; value: number }[] = [];
  for (let i = samples.length - 1; i >= 0 && rows.length < limit; i--) {
    const value = samples[i][metric];
    if (typeof value === "number") rows.push({ ts: samples[i].ts, value });
  }
  return rows;
}

export function averageSamples(samples: Sample[], bucketSize: number): Sample[] {
  if (bucketSize <= 1) return samples;

  const result: Sample[] = [];

  // A bucket never spans two sessions, so averaging old data keeps every point
  // attributable to the one session it came from.
  for (let i = 0; i < samples.length; ) {
    const sessionId = samples[i].sessionId;
    let end = i + 1;
    while (end < samples.length && end - i < bucketSize && samples[end].sessionId === sessionId) {
      end++;
    }
    const bucket = samples.slice(i, end);
    i = end;

    const totals: Record<string, { sum: number; count: number }> = {};

    for (const sample of bucket) {
      for (const [key, value] of Object.entries(sample)) {
        if (typeof value !== "number") continue;
        if (!totals[key]) totals[key] = { sum: 0, count: 0 };
        totals[key].sum += value;
        totals[key].count += 1;
      }
    }

    const averaged: Sample = { ts: 0 };
    for (const [key, { sum, count }] of Object.entries(totals)) {
      const mean = sum / count;
      averaged[key] = key === "ts" ? Math.round(mean) : Math.round(mean * 100) / 100;
    }
    if (sessionId) averaged.sessionId = sessionId;
    result.push(averaged);
  }

  return result;
}

// If there are more than COMPRESS_THRESHOLD samples, keep the newest ones at full
// resolution and average the older ones so the total stays at or under the threshold.
// Samples must be oldest-first.
export function compressSamples(
  samples: Sample[],
  threshold = COMPRESS_THRESHOLD,
  keepRecent = KEEP_RECENT_FULL_RES
): Sample[] {
  if (samples.length <= threshold) return samples;

  const recent = samples.slice(-keepRecent);
  const older = samples.slice(0, samples.length - keepRecent);
  const olderBudget = threshold - keepRecent;
  const bucketSize = Math.ceil(older.length / olderBudget);

  return [...averageSamples(older, bucketSize), ...recent];
}