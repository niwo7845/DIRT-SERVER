#!/usr/bin/env python3
"""Export every reading from every MongoDB data collection to CSV.

One stored document is one timestamped sample, shaped the way the ESP32 posts it
and lib/ingest.ts stores it:

    { _id, data: { ts: 1792981830,
                   data: { co2: 1151, temperature: 18.94, humidity: 43.86 } },
      sessionId: "mw3wdfguae8bd5" | None,
      classification?: "ripe", classificationIndex?: 1, classifiedAt?: ... }

Pre-migration documents hold data.data as a list of { metric, value, unit }
instead, and readings_of() reads either. That nested map becomes one column per
metric, so a collection comes out as a flat time series. Metric names, and any
extra top-level fields the device sends alongside the sample (deviceId, ...),
are discovered from the data rather than hardcoded, so nothing is silently
dropped when the firmware changes.

Writes <out>/<collection>.csv per collection plus <out>/all_collections.csv
with a leading `collection` column. Needs MONGO_URI in the environment or in a
.env / .env.local next to this file.
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pymongo import ASCENDING, MongoClient
from pymongo.errors import PyMongoError

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent  # the Next.js app, which is where .env.local lives

DB_NAME = "food-spoilage"  # lib/mongodb.ts
COMBINED_NAME = "all_collections.csv"

# lib/recording.ts RESERVED_NAMES: app bookkeeping, not readings.
RESERVED = {"__none__", "config", "collectionRegistry", "annotations", "sessions"}

# Columns handled explicitly; everything else top-level is an "extra".
HANDLED = {"_id", "data", "classification", "classificationIndex", "classifiedAt"}

# Metrics lead the row in this order when present (lib/metrics.ts, plus ethanol);
# any metric not listed here still gets a column, appended alphabetically.
METRIC_ORDER = ["co2", "ethylene", "methane", "ethanol", "temperature", "humidity"]

# The unit belongs to the metric, not to each reading, so it is no longer stored.
# Mirrors METRICS in lib/metrics.ts; anything absent here reports no unit, which
# is what getMetric() does for a metric it doesn't know.
UNITS = {
    "co2": "ppm",
    "ethylene": "ppm",
    "methane": "ppm",
    "temperature": "\u00b0C",
    "humidity": "%",
}

LABEL_COLUMNS = ["classification", "classificationIndex", "classifiedAt"]


# --------------------------------------------------------------------------- env


def load_env_files():
    """Read .env / .env.local from this directory and the project root.

    The app keeps its credentials in DIRT-Server/.env.local, one level up from
    scripts/, so look there too. Real environment variables still win.
    """
    for directory in (HERE, PROJECT_ROOT):
        for name in (".env", ".env.local"):
            path = directory / name
            if not path.exists():
                continue
            for line in path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, sep, value = line.partition("=")
                if not sep:
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)


def mongo_uri():
    load_env_files()
    uri = os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URI")
    if not uri:
        sys.exit(
            "MONGO_URI is not set. Put it in the environment, or in a .env or "
            f".env.local file in {HERE} or {PROJECT_ROOT}."
        )
    return uri


# ------------------------------------------------------------------- formatting


def cell(value):
    """One document value as something CSV can hold."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return value
    if isinstance(value, datetime):
        stamped = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return stamped.astimezone(timezone.utc).isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str, separators=(",", ":"))
    return str(value)


def iso_time(ts):
    """Unix seconds as a UTC timestamp, for reading the CSV by eye."""
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        return ""
    try:
        return datetime.fromtimestamp(ts, timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return ""


# ---------------------------------------------------------------------- schema


def data_collections(db, only=None):
    """Data collection names, oldest first, mirroring lib/config.ts."""
    present = [
        name
        for name in db.list_collection_names()
        if name not in RESERVED and not name.startswith("system.")
    ]

    # The registry records creation order; fall back to alphabetical for anything
    # it hasn't seen (and when it doesn't exist yet).
    try:
        order = {
            doc["_id"]: index
            for index, doc in enumerate(
                db["collectionRegistry"].find({}).sort([("createdAt", ASCENDING), ("_id", ASCENDING)])
            )
        }
    except PyMongoError:
        order = {}

    present.sort(key=lambda name: (order.get(name, len(order)), name))

    if only:
        wanted = set(only)
        missing = wanted - set(present)
        if missing:
            sys.exit(f"No such data collection: {', '.join(sorted(missing))}")
        present = [name for name in present if name in wanted]

    return present


def describe(collection):
    """What columns this collection needs, asked of the server rather than guessed."""
    # Readings are a metric -> value map, and older documents hold an array of
    # { metric, value, unit }, so the metric names come out of whichever it is.
    # $objectToArray throws on an array, so this branches on the stored type and
    # leaves an unrecognised payload contributing no metrics at all.
    units = {}
    for doc in collection.aggregate(
        [
            {
                "$project": {
                    "metrics": {
                        "$switch": {
                            "branches": [
                                {
                                    "case": {"$eq": [{"$type": "$data.data"}, "object"]},
                                    "then": {
                                        "$map": {
                                            "input": {"$objectToArray": "$data.data"},
                                            "as": "entry",
                                            "in": "$$entry.k",
                                        }
                                    },
                                },
                                {
                                    "case": {"$isArray": "$data.data"},
                                    "then": {
                                        "$map": {
                                            "input": "$data.data",
                                            "as": "reading",
                                            "in": "$$reading.metric",
                                        }
                                    },
                                },
                            ],
                            "default": [],
                        }
                    }
                }
            },
            {"$unwind": "$metrics"},
            {"$group": {"_id": "$metrics"}},
        ],
        allowDiskUse=True,
    ):
        name = doc["_id"]
        if isinstance(name, str):
            units[name] = UNITS.get(name, "")

    top = {
        doc["_id"]
        for doc in collection.aggregate(
            [
                {"$project": {"key": {"$objectToArray": "$$ROOT"}}},
                {"$unwind": "$key"},
                {"$group": {"_id": "$key.k"}},
            ],
            allowDiskUse=True,
        )
        if isinstance(doc["_id"], str)
    }

    # A payload we don't recognise is stored as sent (lib/ingest.ts), so keep a
    # column for it instead of losing those documents' contents.
    unparsed = (
        collection.find_one({"data": {"$exists": True, "$not": {"$type": "object"}}})
        is not None
    )

    known = [metric for metric in METRIC_ORDER if metric in units]
    extra = sorted(metric for metric in units if metric not in METRIC_ORDER)

    return {
        "metrics": known + extra,
        "units": units,
        "labels": [name for name in LABEL_COLUMNS if name in top],
        "extras": sorted(top - HANDLED),
        "unparsed": unparsed,
    }


def columns(schema, with_collection=False):
    return (
        (["collection"] if with_collection else [])
        + ["timestamp", "iso_time"]
        + schema["metrics"]
        + schema["labels"]
        + schema["extras"]
        + (["data_raw"] if schema["unparsed"] else [])
        + ["_id"]
    )


def merge(schemas):
    """Union schema for the combined CSV."""
    units = {}
    for schema in schemas:
        units.update(schema["units"])
    known = [metric for metric in METRIC_ORDER if metric in units]
    extra = sorted(metric for metric in units if metric not in METRIC_ORDER)
    return {
        "metrics": known + extra,
        "units": units,
        "labels": [name for name in LABEL_COLUMNS if any(name in s["labels"] for s in schemas)],
        "extras": sorted({name for schema in schemas for name in schema["extras"]}),
        "unparsed": any(schema["unparsed"] for schema in schemas),
    }


# ------------------------------------------------------------------------ rows


def readings_of(data):
    """A stored sample's readings, in either shape the database holds.

    Mirrors readingsOf() in lib/metrics.ts. None means a shape we don't
    recognise, which the caller keeps verbatim in a data_raw column.
    """
    if isinstance(data, list):
        readings = {}
        for entry in data:
            if isinstance(entry, dict) and isinstance(entry.get("metric"), str):
                readings[entry["metric"]] = entry.get("value")
        return readings
    if isinstance(data, dict):
        return dict(data)
    return None


def row_for(doc):
    """One stored document flattened into {column: value}."""
    row = {"_id": cell(doc.get("_id"))}

    payload = doc.get("data")
    if isinstance(payload, dict):
        ts = payload.get("ts")
        row["timestamp"] = cell(ts)
        row["iso_time"] = iso_time(ts)

        readings = readings_of(payload.get("data"))
        if readings is not None:
            for metric, value in readings.items():
                row[metric] = cell(value)
        elif payload.get("data") is not None:
            row["data_raw"] = cell(payload.get("data"))
    elif payload is not None:
        row["data_raw"] = cell(payload)

    for key, value in doc.items():
        if key in ("_id", "data"):
            continue
        row[key] = cell(value)

    return row


def export(collection, schema, out_path, combined_writer=None, name=None):
    """Stream the whole collection to its CSV, oldest reading first."""
    fields = columns(schema)
    written = 0
    undated = 0

    cursor = (
        collection.find({})
        .sort("data.ts", ASCENDING)
        .batch_size(1000)
        .allow_disk_use(True)
    )

    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, restval="", extrasaction="ignore")
        writer.writeheader()

        for doc in cursor:
            row = row_for(doc)
            if row.get("timestamp") == "":
                undated += 1
            writer.writerow(row)
            if combined_writer is not None:
                combined_writer.writerow({**row, "collection": name})
            written += 1

    return written, undated


# ------------------------------------------------------------------------ main


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("collections", nargs="*", help="only these collections (default: all)")
    parser.add_argument("--db", default=DB_NAME, help=f"database name (default: {DB_NAME})")
    parser.add_argument(
        "--out",
        default=str(PROJECT_ROOT / "csv"),
        help="output directory (default: <project root>/csv)",
    )
    parser.add_argument("--no-combined", action="store_true", help="skip all_collections.csv")
    args = parser.parse_args()

    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    client = MongoClient(mongo_uri(), serverSelectionTimeoutMS=20000)
    try:
        client.admin.command("ping")
    except PyMongoError as error:
        sys.exit(f"Could not reach MongoDB: {error}")

    db = client[args.db]
    names = data_collections(db, args.collections)
    if not names:
        sys.exit(f"No data collections in {args.db}.")

    print(f"{args.db}: {len(names)} collection(s) -> {out_dir}\n")

    schemas = {}
    for name in names:
        schemas[name] = describe(db[name])

    combined_handle = None
    combined_writer = None
    if not args.no_combined and len(names) >= 1:
        union = merge(list(schemas.values()))
        combined_handle = (out_dir / COMBINED_NAME).open("w", newline="", encoding="utf-8")
        combined_writer = csv.DictWriter(
            combined_handle,
            fieldnames=columns(union, with_collection=True),
            restval="",
            extrasaction="ignore",
        )
        combined_writer.writeheader()

    total = 0
    try:
        for name in names:
            schema = schemas[name]
            rows, undated = export(
                db[name],
                schema,
                out_dir / f"{name}.csv",
                combined_writer=combined_writer,
                name=name,
            )
            total += rows

            metrics = ", ".join(
                f"{metric} ({schema['units'][metric]})" if schema["units"].get(metric) else metric
                for metric in schema["metrics"]
            ) or "no metrics"
            notes = []
            if schema["labels"]:
                notes.append("labeled")
            if undated:
                notes.append(f"{undated} without a timestamp")
            if schema["unparsed"]:
                notes.append("some documents in an unrecognised shape")
            suffix = f"  [{'; '.join(notes)}]" if notes else ""

            print(f"{name}.csv: {rows:,} readings — {metrics}{suffix}")
    finally:
        if combined_handle is not None:
            combined_handle.close()
        client.close()

    print(f"\n{total:,} readings in total.")
    if combined_writer is not None:
        print(f"Combined: {out_dir / COMBINED_NAME}")


if __name__ == "__main__":
    main()
