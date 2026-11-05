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
  docs: Sample[]; // every document to insert, in one go
  discarded: number; // samples dropped for having no usable metric left
}

export interface Context {
  annotation: Annotation | null;
  sessionId: string | null; // the open session, or null outside one
}

// Separates the samples from whatever the device sends alongside them (device id,
// session id, ...). The top-level `data` is a list, but a lone object is still
// accepted so firmware that posts one sample at a time keeps working and the two
// can be swapped over without a flag day. Null when the shape isn't one we know.
function split(body: unknown): { envelope: Sample; samples: Sample[] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const { data, ...envelope } = body as Sample;
  if (Array.isArray(data)) return { envelope, samples: data as Sample[] };
  if (data && typeof data === "object") return { envelope, samples: [data as Sample] };
  return null;
}

// Strips the metrics the device flagged as missing, so a dead or warming-up sensor
// leaves a gap in the charts instead of a -1 spike. Returns null when the sample
// has nothing left but a timestamp.
function withoutMissingMetrics(sample: Sample): Sample | null {
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
function classificationFor(annotation: Annotation | null, ts: unknown) {
  if (!annotation || typeof ts !== "number" || !Number.isFinite(ts)) return null;

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
// Every document carries the session that was open when it arrived, or null when
// none was, which is what separates a run of the chamber from the gap after it.
// The server decides that, so it is written after the envelope and a sessionId the
// device sent cannot override it — as with `data` and the classification fields.
//
// A payload we don't recognise comes back as a single document holding the body
// as sent, so nothing is dropped and the caller still has just one list to insert.
export function prepareDocuments(body: unknown, context: Context): Prepared {
  const parts = split(body);
  if (!parts) return { docs: [body as Sample], discarded: 0 };

  const docs: Sample[] = [];
  for (const sample of parts.samples) {
    const trimmed = withoutMissingMetrics(sample);
    if (!trimmed) continue;

    docs.push({
      ...parts.envelope,
      data: trimmed,
      sessionId: context.sessionId,
      ...classificationFor(context.annotation, trimmed.ts),
    });
  }

  return { docs, discarded: parts.samples.length - docs.length };
}
