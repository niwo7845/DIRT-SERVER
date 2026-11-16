import { Sample, getMetric } from "@/lib/metrics";

// Rates are per minute: per second is too small to read for anything the chamber
// does, per hour too coarse to compare with a session that lasts ten minutes.
const SECONDS_PER_MINUTE = 60;

// "ppm/min", "°C/min", "%/min" — the metric's own unit, over time.
export function rateUnit(metric: string): string {
  return `${getMetric(metric).unit}/min`;
}

// One point per session: that session's average rate of change in `metric`, placed
// at the middle of the time the session's readings span. Oldest first, in the
// shape the charts already take, so a rate chart is just a chart of these.
//
// The rate is the least-squares slope through the session's readings rather than
// (last - first) / duration. Both are the average rate of change, but the sensors
// jitter by more than a session's drift, and the two end readings alone would
// make every point a measure of noise on two samples.
//
// Readings outside any session have no sessionId and are skipped, as are sessions
// with fewer than two readings or no time between them: there is no rate to speak of.
//
// So is the session still running, which is the one the newest reading belongs to
// (readings after a stop carry no sessionId). Its first few readings give a slope
// that is nearly all noise, and it would show up as a wild point at the right edge
// of the chart until enough readings had arrived. It appears once it has ended.
export function sessionRates(samples: Sample[], metric: string): Sample[] {
  const running = samples.length ? samples[samples.length - 1].sessionId : undefined;
  const bySession = new Map<string, { ts: number; value: number }[]>();

  for (const sample of samples) {
    const value = sample[metric];
    if (!sample.sessionId || sample.sessionId === running || typeof value !== "number") continue;

    const points = bySession.get(sample.sessionId);
    if (points) points.push({ ts: sample.ts, value });
    else bySession.set(sample.sessionId, [{ ts: sample.ts, value }]);
  }

  const rates: Sample[] = [];

  for (const [sessionId, points] of bySession) {
    if (points.length < 2) continue;

    let first = Infinity;
    let last = -Infinity;
    for (const p of points) {
      if (p.ts < first) first = p.ts;
      if (p.ts > last) last = p.ts;
    }
    if (last <= first) continue;

    // Minutes since the first reading, so the numbers stay small and the slope
    // comes out per minute directly.
    let sumX = 0;
    let sumY = 0;
    for (const p of points) {
      sumX += (p.ts - first) / SECONDS_PER_MINUTE;
      sumY += p.value;
    }
    const meanX = sumX / points.length;
    const meanY = sumY / points.length;

    let covariance = 0;
    let variance = 0;
    for (const p of points) {
      const dx = (p.ts - first) / SECONDS_PER_MINUTE - meanX;
      covariance += dx * (p.value - meanY);
      variance += dx * dx;
    }
    if (variance === 0) continue;

    rates.push({
      ts: Math.round((first + last) / 2),
      sessionId,
      // Significant figures, not decimal places: ethylene drifts in thousandths
      // where CO₂ moves in whole ppm.
      [metric]: Number((covariance / variance).toPrecision(4)),
    });
  }

  return rates.sort((a, b) => a.ts - b.ts);
}
