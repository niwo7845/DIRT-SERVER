// Readings out of Mongo and into a CSV, for training or for a spreadsheet.
//
// This is the TypeScript side of scripts/jsonToCSV.py: same columns, same order,
// same cell formatting, so the two produce identical files. The script exports
// every collection offline; this exports the one being viewed, on demand.
//
// Deliberately NOT built on getSamples()/toSamples(): those cap at MAX_DOCS and
// run compressSamples(), which averages older readings down to a few thousand
// points. That is right for a chart and wrong for an export — a run would come
// out smoothed, with no sign that it had been. Here every stored document
// becomes exactly one row.

import type { Collection, Document } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { METRICS, getMetric, readingsOf } from "@/lib/metrics";

// Known metrics lead the row in registry order; anything else is appended
// alphabetically, so a new sensor shows up without this file changing.
const METRIC_ORDER = Object.keys(METRICS);

const LABEL_COLUMNS = ["classification", "classificationIndex", "classifiedAt"];

// Columns built by hand below; every other top-level field is an "extra".
const HANDLED = new Set(["_id", "data", ...LABEL_COLUMNS]);

const ROWS_PER_CHUNK = 500;

// RFC 4180, and what Python's csv module writes, so this and
// scripts/jsonToCSV.py produce byte-identical files.
const LINE_END = "\r\n";

export interface ExportSchema {
  metrics: string[];
  units: Record<string, string>;
  labels: string[];
  extras: string[];
  unparsed: boolean;
}

function orderMetrics(units: Record<string, string>): string[] {
  const known = METRIC_ORDER.filter((metric) => metric in units);
  const extra = Object.keys(units)
    .filter((metric) => !METRIC_ORDER.includes(metric))
    .sort();
  return [...known, ...extra];
}

// Asked of the server rather than assumed, so nothing a device sends is dropped.
export async function describeCollection(
  collection: Collection<Document>
): Promise<ExportSchema> {
  // Readings are a metric -> value map, and older documents hold an array of
  // { metric, value, unit }, so the metric names come out of whichever it is.
  // $objectToArray throws on an array, so this branches on the stored type and
  // leaves an unrecognised payload contributing no metrics at all.
  const metricRows = await collection
    .aggregate(
      [
        {
          $project: {
            metrics: {
              $switch: {
                branches: [
                  {
                    case: { $eq: [{ $type: "$data.data" }, "object"] },
                    then: {
                      $map: {
                        input: { $objectToArray: "$data.data" },
                        as: "entry",
                        in: "$$entry.k",
                      },
                    },
                  },
                  {
                    case: { $isArray: "$data.data" },
                    then: {
                      $map: { input: "$data.data", as: "reading", in: "$$reading.metric" },
                    },
                  },
                ],
                default: [],
              },
            },
          },
        },
        { $unwind: "$metrics" },
        { $group: { _id: "$metrics" } },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  // The unit is a property of the metric, so it is read from the registry rather
  // than from the documents, which no longer carry one.
  const units: Record<string, string> = {};
  for (const row of metricRows) {
    if (typeof row._id === "string") {
      units[row._id] = getMetric(row._id).unit;
    }
  }

  const keyRows = await collection
    .aggregate(
      [
        { $project: { key: { $objectToArray: "$$ROOT" } } },
        { $unwind: "$key" },
        { $group: { _id: "$key.k" } },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  const top = new Set(
    keyRows.map((row) => row._id).filter((key): key is string => typeof key === "string")
  );

  // A payload lib/ingest.ts didn't recognise is stored as sent, so give it a
  // column instead of losing those documents' contents.
  const unparsed =
    (await collection.findOne({ data: { $exists: true, $not: { $type: "object" } } })) !== null;

  return {
    metrics: orderMetrics(units),
    units,
    labels: LABEL_COLUMNS.filter((name) => top.has(name)),
    extras: [...top].filter((key) => !HANDLED.has(key)).sort(),
    unparsed,
  };
}

export function exportColumns(schema: ExportSchema): string[] {
  return [
    "timestamp",
    "iso_time",
    ...schema.metrics,
    ...schema.labels,
    ...schema.extras,
    ...(schema.unparsed ? ["data_raw"] : []),
    "_id",
  ];
}

// Unix seconds as a UTC timestamp, for reading the file by eye. Formatted with
// a +00:00 offset to match Python's datetime.isoformat().
function isoTime(ts: unknown): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

// One document value as text. ObjectId and Date come back from the driver as
// objects, so they are converted before the generic JSON fallback.
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  if (typeof value === "object") {
    const id = value as { toHexString?: () => string };
    if (typeof id.toHexString === "function") return id.toHexString();
    return JSON.stringify(value);
  }
  return String(value);
}

function escape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// One stored document flattened into {column: value}.
export function rowFor(doc: Document): Record<string, string> {
  const row: Record<string, string> = { _id: cell(doc._id) };

  const payload = doc.data;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const sample = payload as Document;
    row.timestamp = cell(sample.ts);
    row.iso_time = isoTime(sample.ts);

    const readings = readingsOf(sample.data);
    if (readings) {
      for (const [metric, value] of Object.entries(readings)) {
        row[metric] = cell(value);
      }
    } else if (sample.data !== null && sample.data !== undefined) {
      row.data_raw = cell(sample.data);
    }
  } else if (payload !== null && payload !== undefined) {
    row.data_raw = cell(payload);
  }

  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id" || key === "data") continue;
    row[key] = cell(value);
  }

  return row;
}

export function csvLine(row: Record<string, string>, fields: string[]): string {
  return fields.map((field) => escape(row[field] ?? "")).join(",");
}

// The whole collection as a stream, oldest reading first. Streamed rather than
// built in memory so a long run doesn't have to fit in the server's heap twice
// before the download starts.
export async function streamCollectionCsv(
  collectionName: string
): Promise<ReadableStream<Uint8Array>> {
  const db = await getDb();
  const collection = db.collection(collectionName);

  const schema = await describeCollection(collection);
  const fields = exportColumns(schema);

  const cursor = collection
    .find({})
    .sort({ "data.ts": 1 })
    .batchSize(ROWS_PER_CHUNK)
    .allowDiskUse();

  const encoder = new TextEncoder();
  let header = `${fields.join(",")}${LINE_END}`;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const lines: string[] = [];
        if (header) {
          lines.push(header);
          header = "";
        }

        // A batch per pull: one enqueue for 500 rows rather than 500 of them.
        for (let i = 0; i < ROWS_PER_CHUNK; i++) {
          const doc = await cursor.next();
          if (!doc) {
            if (lines.length > 0) controller.enqueue(encoder.encode(lines.join("")));
            controller.close();
            await cursor.close();
            return;
          }
          lines.push(`${csvLine(rowFor(doc), fields)}${LINE_END}`);
        }

        controller.enqueue(encoder.encode(lines.join("")));
      } catch (err) {
        controller.error(err);
        await cursor.close().catch(() => {});
      }
    },
    async cancel() {
      // The browser gave up on the download; drop the cursor server-side too.
      await cursor.close().catch(() => {});
    },
  });
}
