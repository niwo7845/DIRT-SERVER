import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { Sample, compressSamples, readingsOf } from "@/lib/metrics";

export const MAX_DOCS = 50000; // most documents to read per page load (~5 weeks at 1/min)

// Most recent readings the live dashboard pulls in one poll. Bounds a client
// that reconnects after a long gap to one catch-up batch instead of everything
// since it was last seen.
export const MAX_LIVE_SAMPLES = 5000;

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

// Both the full load and the live poll sort on data.ts, so both want this index.
// Created at most once per collection per server process — createIndex is a cheap
// no-op when it already exists, but that's still a round trip worth skipping on
// every single poll.
const indexedCollections = new Set<string>();

async function ensureTsIndex(db: Db, collectionName: string): Promise<void> {
  if (indexedCollections.has(collectionName)) return;
  indexedCollections.add(collectionName);

  await db
    .collection(collectionName)
    .createIndex({ "data.ts": 1 })
    .catch((err) => console.error(`createIndex(data.ts) on ${collectionName} failed:`, err));
}

function sampleOf(doc: SensorDoc): Sample {
  const sample: Sample = { ts: doc.ts };
  for (const [metric, value] of Object.entries(readingsOf(doc.data) ?? {})) {
    if (typeof value === "number") sample[metric] = value;
  }
  return sample;
}

// Readings for one run, newest first.
export async function getSensorDocs(collectionName: string): Promise<SensorDoc[]> {
  const db = await getDb();
  await ensureTsIndex(db, collectionName);

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
  return compressSamples(docs.map(sampleOf).reverse());
}

export async function getSamples(collectionName: string): Promise<Sample[]> {
  return toSamples(await getSensorDocs(collectionName));
}

// Samples strictly newer than afterTs, oldest first — what the live dashboard
// appends to what it already has. Already sorted ascending by the query, so
// unlike toSamples() there's nothing to reverse, and nothing to compress: the
// client merges this into samples it already holds and compresses once there.
export async function getSamplesSince(
  collectionName: string,
  afterTs: number,
  limit: number = MAX_LIVE_SAMPLES
): Promise<Sample[]> {
  const db = await getDb();
  await ensureTsIndex(db, collectionName);

  const rawDocs = (await db
    .collection(collectionName)
    .find({ "data.ts": { $gt: afterTs } })
    .sort({ "data.ts": 1 })
    .limit(limit)
    .toArray()) as unknown as MongoDoc[];

  return rawDocs
    .map((raw) => raw.data)
    .filter((doc): doc is SensorDoc => Boolean(doc))
    .map(sampleOf);
}
