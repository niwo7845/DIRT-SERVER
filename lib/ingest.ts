// Turning what the ESP32 posts into the documents to store.
// No database code here, so the ingest rules can be exercised on their own
// (same client-safe split as lib/recording.ts and lib/annotations.ts).

import { type Annotation, stageForTs } from "@/lib/annotations";

// The value the device sends for a metric it couldn't read this cycle.
export const MISSING = -1;

// One timestamped sample as the device sends it:
//   { ts: 1792981830, data: [{ metric: "co2", value: 1151, unit: "ppm" }, ...] }
export type Sample = Record<string, unknown>;

export interface Prepared {
  docs: Sample[]; // one document per sample, ready to insert
  discarded: number; // samples dropped for having no usable metric left
  recognised: boolean; // false: payload isn't a shape we know, store it as sent
}

// The device batches samples, so the top-level `data` is a list of them. A lone
// object is still accepted, so firmware that posts one sample at a time keeps
// working and the two can be swapped over without a flag day.
export function sampleList(data: unknown): Sample[] | null {
  if (Array.isArray(data)) return data as Sample[];
  if (data && typeof data === "object") return [data as Sample];
  return null;
}

// Strips the metrics the device flagged as missing, so a dead or warming-up sensor
// leaves a gap in the charts instead of a -1 spike. Returns null when the sample
// has nothing left but a timestamp.
export function withoutMissingMetrics(sample: Sample): Sample | null {
  const readings = sample?.data;
  if (!Array.isArray(readings)) return sample ?? null; // shape we don't know: store as sent

  const kept = readings.filter((reading) => reading?.value !== MISSING);
  if (kept.length === 0) return null;
  if (kept.length === readings.length) return sample;

  return { ...sample, data: kept };
}

// Labels a sample as it arrives, so an ongoing final stage keeps labeling new data
// without anyone having to re-apply the annotation. Each sample is labeled by its
// own timestamp, so a batch that straddles a stage boundary is split correctly.
export function classificationFor(annotation: Annotation, ts: unknown) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;

  const match = stageForTs(ts, annotation.stages, annotation.ranges);
  if (!match) return null;

  return {
    classification: match.stage.name,
    classificationIndex: match.index,
    classifiedAt: new Date(),
  };
}

// One document per sample, so the stored shape is the same whether the device
// batches or not, and the dashboard, the indexes and the annotation queries all
// keep working on data.ts unchanged.
//
// Anything the device sends alongside the samples (device id, session id, ...)
// describes the whole batch, so it is copied onto each sample's document.
export function prepareDocuments(body: unknown, annotation: Annotation | null): Prepared {
  const envelope: Sample = {};
  let data: unknown;

  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (key === "data") data = value;
      else envelope[key] = value;
    }
  }

  const samples = sampleList(data);
  if (!samples) return { docs: [], discarded: 0, recognised: false };

  const docs: Sample[] = [];
  for (const sample of samples) {
    const trimmed = withoutMissingMetrics(sample);
    if (!trimmed) continue;

    const classification = annotation ? classificationFor(annotation, trimmed.ts) : null;
    docs.push({ ...envelope, data: trimmed, ...classification });
  }

  return { docs, discarded: samples.length - docs.length, recognised: true };
}
