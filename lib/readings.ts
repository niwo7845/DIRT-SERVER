import { getDb } from "@/lib/mongodb";
import { Sample, compressSamples, readingsOf } from "@/lib/metrics";

export const MAX_DOCS = 50000; // most documents to read per page load (~5 weeks at 1/min)

// What the ESP32 sends, as stored under the document's "data" field. `data` is a
// metric -> value map; older documents hold an array of { metric, value, unit }
// instead, so readingsOf() is what reads it either way.
export interface SensorDoc {
  ts: number; // unix seconds
  data: unknown;
}

interface MongoDoc {
  _id: unknown;
  data: SensorDoc;
}

// Readings for one run, newest first.
export async function getSensorDocs(collectionName: string): Promise<SensorDoc[]> {
  const db = await getDb();
  const rawDocs = (await db
    .collection(collectionName)
    .find({})
    .sort({ "data.ts": -1 })
    .limit(MAX_DOCS)
    .toArray()) as unknown as MongoDoc[];

  return rawDocs.map((raw) => raw.data).filter((doc): doc is SensorDoc => Boolean(doc));
}

// One Sample per timestamp, oldest first (what the charts want) and compressed
// so a long run doesn't ship tens of thousands of points to the browser.
export function toSamples(docs: SensorDoc[]): Sample[] {
  const samples = docs
    .map((doc) => {
      const sample: Sample = { ts: doc.ts };
      for (const [metric, value] of Object.entries(readingsOf(doc.data) ?? {})) {
        if (typeof value === "number") sample[metric] = value;
      }
      return sample;
    })
    .reverse();

  return compressSamples(samples);
}

export async function getSamples(collectionName: string): Promise<Sample[]> {
  return toSamples(await getSensorDocs(collectionName));
}
