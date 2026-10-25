// One flat sample = one timestamp plus any number of metric values.
// e.g. { ts: 1790390056, co2: 900, temperature: 77, humidity: 48, methane: 100 }
export interface Sample {
  ts: number; // unix seconds
  [metric: string]: number | undefined;
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
export function averageSamples(samples: Sample[], bucketSize: number): Sample[] {
  if (bucketSize <= 1) return samples;

  const result: Sample[] = [];

  for (let i = 0; i < samples.length; i += bucketSize) {
    const bucket = samples.slice(i, i + bucketSize);
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