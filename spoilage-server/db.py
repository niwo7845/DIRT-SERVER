"""
db.py
Database setup for the food spoilage monitor.

All timestamps are stored as INTEGER Unix epoch seconds (UTC).
Dates printed on packaging are stored as TEXT in YYYY-MM-DD format.
Derived values (elapsed time, gas ratios, time-to-spoil) are NOT stored;
they are computed at export time so the raw data stays untouched.
"""

import math
import re
import sqlite3
import time
from pathlib import Path

DB_PATH = "spoilage.db"
BUSY_TIMEOUT_S = 10  # seconds to wait if another connection is mid-write
DEVICE_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9 ._-]{0,63}$")  # "board in use", "box_01"
MAX_SAMPLES_PER_POST = 100
MIN_VALID_TS = 1735689600   # 2025-01-01 00:00:00 UTC; anything earlier means NTP never synced
MAX_FUTURE_SKEW_S = 300     # allow device clock to run up to 5 min ahead of the server

NOW = "(CAST(strftime('%s','now') AS INTEGER))"  # works on older SQLite versions

SCHEMA = f"""
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per physical food item (banana_001, apple_014, ...)
CREATE TABLE IF NOT EXISTS food_items (
    id               INTEGER PRIMARY KEY,
    label            TEXT NOT NULL UNIQUE,
    item_type        TEXT NOT NULL,
    source           TEXT,
    acquired_date    TEXT,
    date_type        TEXT CHECK (date_type IN ('best_by', 'use_by', 'sell_by')),
    best_by_date     TEXT,
    initial_mass_g   REAL,
    initial_ripeness TEXT,
    notes            TEXT,
    created_utc      INTEGER NOT NULL DEFAULT {NOW},
    CHECK ((date_type IS NULL) = (best_by_date IS NULL))
);

-- One row per experimental protocol (EXP01, EXP02, ...)
CREATE TABLE IF NOT EXISTS experiments (
    id                    INTEGER PRIMARY KEY,
    code                  TEXT NOT NULL UNIQUE,
    description           TEXT,
    variable_being_tested TEXT,
    box_volume_L          REAL,
    ambient_condition     TEXT,
    created_utc           INTEGER NOT NULL DEFAULT {NOW}
);

-- One row per ESP32, keyed by WiFi MAC. Auto-registered on first POST.
CREATE TABLE IF NOT EXISTS devices (
    id               TEXT PRIMARY KEY,
    display_name     TEXT,
    first_seen_utc   INTEGER NOT NULL DEFAULT {NOW},
    last_seen_utc    INTEGER,
    notes            TEXT
);

-- Registry of allowed metrics. Adding a sensor = adding a row here.
CREATE TABLE IF NOT EXISTS metrics (
    name        TEXT PRIMARY KEY,
    unit        TEXT NOT NULL,
    description TEXT
);

-- One row per time a device monitors something.
--   training:   food in the box until it is too far gone (label source)
--   control:    empty box, no food item
--   spot_check: single short measurement of a new item (model input later)
CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY,
    run_code      TEXT NOT NULL UNIQUE,
    run_type      TEXT NOT NULL
                  CHECK (run_type IN ('training', 'control', 'spot_check')),
    experiment_id INTEGER REFERENCES experiments(id),
    food_item_id  INTEGER REFERENCES food_items(id),
    device_id     TEXT NOT NULL REFERENCES devices(id),
    start_utc     INTEGER NOT NULL,
    end_utc       INTEGER,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'complete', 'aborted')),
    end_reason    TEXT
                  CHECK (end_reason IN ('spoiled', 'planned_stop',
                                        'sensor_failure', 'aborted')),
    notes         TEXT,
    CHECK ((run_type = 'control') = (food_item_id IS NULL)),
    CHECK ((status = 'active') = (end_utc IS NULL)),
    CHECK (status != 'active' OR end_reason IS NULL),
    CHECK (end_utc IS NULL OR end_utc >= start_utc)
);

-- A device can only have one active run at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_device
    ON runs(device_id) WHERE status = 'active';

-- Raw sensor data, long format. run_id is NULL if no run was active,
-- so nothing a device sends is ever thrown away.
CREATE TABLE IF NOT EXISTS readings (
    id        INTEGER PRIMARY KEY,
    run_id    INTEGER REFERENCES runs(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    device_ts INTEGER NOT NULL,
    server_ts INTEGER NOT NULL,
    metric    TEXT NOT NULL REFERENCES metrics(name),
    value     REAL,
    sensor    TEXT,
    UNIQUE (device_id, device_ts, metric)
);

CREATE INDEX IF NOT EXISTS idx_readings_run_metric_ts
    ON readings(run_id, metric, device_ts);

-- Things that happen during a run: venting, resealing, photos, notes
CREATE TABLE IF NOT EXISTS run_events (
    id         INTEGER PRIMARY KEY,
    run_id     INTEGER NOT NULL REFERENCES runs(id),
    ts         INTEGER NOT NULL DEFAULT {NOW},
    event_type TEXT NOT NULL
               CHECK (event_type IN ('vent', 'reseal', 'opened', 'photo', 'note')),
    photo_path TEXT,
    notes      TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_ts ON run_events(run_id, ts);
"""

DEFAULT_METRICS = [
    ("co2",         "ppm", "Carbon dioxide concentration"),
    ("ethylene",    "ppm", "Ethylene (C2H4) concentration"),
    ("methane",     "ppm", "Methane (CH4) concentration"),
    ("humidity",    "%RH", "Relative humidity"),
    ("temperature", "C",   "Air temperature inside the box"),
]


def init_db(db_path: str = DB_PATH) -> None:
    """
    Create the database file and all tables if they do not exist,
    then seed the metric registry. Safe to run repeatedly.
    """
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT OR IGNORE INTO metrics (name, unit, description) VALUES (?, ?, ?)",
            DEFAULT_METRICS,
        )
        conn.commit()
    finally:
        conn.close()


def get_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    """
    Open a connection configured the way every part of the server needs it.

    - Foreign keys ON: SQLite turns them off by default on every new
      connection, so the schema's REFERENCES rules are only enforced if
      this runs each time.
    - Row factory: rows can be read by column name, e.g. row["label"].
    - Busy timeout: if another connection is writing, wait instead of
      failing immediately with "database is locked".

    The caller is responsible for closing the connection.
    """
    conn = sqlite3.connect(db_path, timeout=BUSY_TIMEOUT_S)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def register_device(conn: sqlite3.Connection, device_id: str,
                    now: int | None = None) -> str:
    """
    Record that a device has checked in.

    device_id is a free-form name chosen by the team, e.g. "board in use"
    or "box_01". It is normalized to a lookup key: outer whitespace removed,
    runs of spaces collapsed to one, lowercased. So "Board In Use" and
    "board  in use" are the same device. The first spelling seen is kept in
    display_name for the website.

    - First time a name is seen: insert it with first_seen_utc = last_seen_utc = now.
    - Every time after: update last_seen_utc.

    Does NOT commit. The caller commits, so registering the device and saving
    its readings succeed or fail together as one transaction.

    Returns the normalized key, which callers should use from then on.
    Raises ValueError if the name is empty, too long, or has odd characters.
    """
    if not isinstance(device_id, str):
        raise ValueError(f"device_id must be a string, got {type(device_id).__name__}")

    display_name = " ".join(device_id.split())  # trim ends, collapse inner spaces
    key = display_name.lower()
    if not DEVICE_NAME_PATTERN.match(key):
        raise ValueError(
            "device_id must be 1 to 64 characters, start with a letter or digit, "
            "and use only letters, digits, spaces, '.', '_' or '-'; "
            f"got {device_id!r}"
        )

    if now is None:
        now = int(time.time())

    conn.execute(
        """
        INSERT INTO devices (id, display_name, first_seen_utc, last_seen_utc)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            last_seen_utc = excluded.last_seen_utc
        """,
        (key, display_name, now, now),
    )
    return key


def insert_readings(conn: sqlite3.Connection, device_id: str,
                    samples: list, server_ts: int | None = None) -> dict:
    """
    Validate and store the "samples" array from one POST.

    - Each reading is checked on its own. Bad readings are rejected and
      reported; good readings in the same payload are still saved.
    - Each sample is attached to whichever run on this device covers its
      timestamp, so a backlog uploaded after a WiFi outage still lands in
      the correct run. No matching run means run_id = NULL.
    - Duplicates (same device, ts, metric) are skipped and counted, so the
      ESP can safely resend.

    device_id must already be registered (call register_device first).
    Does NOT commit; the caller commits.

    Raises ValueError if the payload structure itself is unusable, in which
    case nothing from it should be saved.

    Returns {"accepted": int, "duplicates": int, "rejected": [ {...}, ... ]}
    """
    if server_ts is None:
        server_ts = int(time.time())

    if not isinstance(samples, list) or not samples:
        raise ValueError("samples must be a non-empty list")
    if len(samples) > MAX_SAMPLES_PER_POST:
        raise ValueError(f"at most {MAX_SAMPLES_PER_POST} samples per POST, got {len(samples)}")

    # Metric registry, e.g. {"co2": "ppm", "humidity": "%RH", ...}
    registry = {row["name"]: row["unit"]
                for row in conn.execute("SELECT name, unit FROM metrics")}

    # Every run this device has ever had, newest first
    runs = conn.execute(
        "SELECT id, start_utc, end_utc FROM runs WHERE device_id = ? ORDER BY start_utc DESC",
        (device_id,),
    ).fetchall()

    def find_run(ts: int) -> int | None:
        for run in runs:
            if run["start_utc"] <= ts and (run["end_utc"] is None or ts <= run["end_utc"]):
                return run["id"]
        return None

    accepted = 0
    duplicates = 0
    rejected = []

    def reject(sample_i, reading_i, metric, reason):
        rejected.append({"sample": sample_i, "reading": reading_i,
                         "metric": metric, "reason": reason})

    for i, sample in enumerate(samples):
        # ---- sample-level checks: a failure here rejects the whole sample ----
        if not isinstance(sample, dict):
            reject(i, None, None, "sample must be a JSON object")
            continue

        ts = sample.get("ts")
        if type(ts) is not int:  # excludes floats, strings, null, and True/False
            reject(i, None, None, "ts must be an integer (Unix seconds, UTC)")
            continue
        if ts < MIN_VALID_TS:
            reject(i, None, None, "ts is before 2025-01-01; has the ESP synced NTP?")
            continue
        if ts > server_ts + MAX_FUTURE_SKEW_S:
            reject(i, None, None, "ts is in the future; check the ESP clock")
            continue

        readings = sample.get("readings")
        if not isinstance(readings, list) or not readings:
            reject(i, None, None, "readings must be a non-empty list")
            continue

        run_id = find_run(ts)

        # ---- reading-level checks: a failure here rejects only that reading ----
        for j, reading in enumerate(readings):
            if not isinstance(reading, dict):
                reject(i, j, None, "reading must be a JSON object")
                continue

            metric = reading.get("metric")
            if not isinstance(metric, str) or metric not in registry:
                reject(i, j, metric if isinstance(metric, str) else None,
                       f"unknown metric; allowed: {sorted(registry)}")
                continue

            unit = reading.get("unit")
            if unit != registry[metric]:
                reject(i, j, metric, f"unit must be '{registry[metric]}'")
                continue

            if "value" not in reading:
                reject(i, j, metric, "value is missing (send null for a failed read)")
                continue
            value = reading["value"]
            if value is not None:
                if type(value) not in (int, float) or not math.isfinite(value):
                    reject(i, j, metric, "value must be a finite number or null")
                    continue
                value = float(value)

            sensor = reading.get("sensor")
            if sensor is not None and not isinstance(sensor, str):
                reject(i, j, metric, "sensor must be a string if present")
                continue

            cur = conn.execute(
                """
                INSERT INTO readings
                    (run_id, device_id, device_ts, server_ts, metric, value, sensor)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id, device_ts, metric) DO NOTHING
                """,
                (run_id, device_id, ts, server_ts, metric, value, sensor),
            )
            if cur.rowcount == 1:
                accepted += 1
            else:
                duplicates += 1

    return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected}


if __name__ == "__main__":
    init_db()
    print("spoilage.db is ready")
