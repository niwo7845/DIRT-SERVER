"""
db.py
Database setup for the food spoilage monitor.

All timestamps are stored as INTEGER Unix epoch seconds (UTC).
Dates printed on packaging are stored as TEXT in YYYY-MM-DD format.
Derived values (elapsed time, gas ratios, time-to-spoil) are NOT stored;
they are computed at export time so the raw data stays untouched.
"""

import sqlite3
from pathlib import Path

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
    nickname         TEXT UNIQUE,
    firmware_version TEXT,
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


def init_db(db_path: str = "spoilage.db") -> None:
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


if __name__ == "__main__":
    init_db()
    print("spoilage.db is ready")
