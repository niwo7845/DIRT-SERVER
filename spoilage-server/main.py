import sqlite3
import time
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import db

app = FastAPI(title="DIRT Spoilage Monitor API")

# Ensure database tables and default metrics are initialized on server startup
db.init_db("spoilage.db")


# Pydantic schemas for payload validation
class SingleMetric(BaseModel):
  metric: str  # e.g., "co2", "ethylene", "temperature", "humidity"
  value: float
  sensor: Optional[str] = None


class SensorPayload(BaseModel):
  device_id: str  # e.g., ESP32 MAC address "AA:BB:CC:DD:EE:FF"
  firmware_version: Optional[str] = "1.0.0"
  device_ts: Optional[int] = None  # Unix timestamp from device
  readings: List[SingleMetric]


@app.on_event("startup")
def startup_event():
  db.init_db("spoilage.db")


@app.get("/")
def read_root():
  return {"status": "online", "system": "DIRT Spoilage Monitor Server"}


@app.post("/api/v1/readings")
def receive_readings(payload: SensorPayload):
  server_ts = int(time.time())
  device_ts = payload.device_ts if payload.device_ts else server_ts

  conn = sqlite3.connect("spoilage.db")
  cursor = conn.cursor()

  try:
    # 1. Auto-register device on first POST, or update last_seen_utc
    cursor.execute(
        """
            INSERT INTO devices (id, firmware_version, last_seen_utc)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                firmware_version = excluded.firmware_version,
                last_seen_utc = excluded.last_seen_utc
        """,
        (payload.device_id, payload.firmware_version, server_ts),
    )

    # 2. Get active run_id for this device (if any)
    cursor.execute(
        "SELECT id FROM runs WHERE device_id = ? AND status = 'active'",
        (payload.device_id,),
    )
    row = cursor.fetchone()
    active_run_id = row[0] if row else None

    # 3. Insert sensor metrics into readings table
    for item in payload.readings:
      cursor.execute(
          """
                INSERT OR REPLACE INTO readings (run_id, device_id, device_ts, server_ts, metric, value, sensor)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
          (
              active_run_id,
              payload.device_id,
              device_ts,
              server_ts,
              item.metric,
              item.value,
              item.sensor,
          ),
      )

    conn.commit()
    return {
        "status": "success",
        "active_run_id": active_run_id,
        "readings_logged": len(payload.readings),
    }

  except sqlite3.Error as e:
    conn.rollback()
    raise HTTPException(status_code=500, detail=f"Database error: {e}")
  finally:
    conn.close()