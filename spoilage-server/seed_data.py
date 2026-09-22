import random
import sqlite3
import time
import db

# 1. Ensure database schema exists
db.init_db("spoilage.db")

conn = sqlite3.connect("spoilage.db")
cursor = conn.cursor()

print("🌱 Seeding test data into spoilage.db...")

# 2. Insert test food item
cursor.execute("""
    INSERT OR IGNORE INTO food_items (id, label, item_type, source, acquired_date)
    VALUES (1, 'banana_001', 'Banana', 'Local Grocery', '2026-09-20')
""")

# 3. Insert test experiment metadata
cursor.execute("""
    INSERT OR IGNORE INTO experiments (id, code, description, box_volume_L)
    VALUES (1, 'EXP01', 'Baseline Banana Spoilage Monitoring', 15.0)
""")

# 4. Insert test device entry
cursor.execute("""
    INSERT OR IGNORE INTO devices (id, nickname, firmware_version)
    VALUES ('ESP32-TEST-MAC', 'Chamber-Alpha', '1.0.0')
""")

# 5. Insert an active run
now_epoch = int(time.time())
cursor.execute(
    """
    INSERT OR IGNORE INTO runs (id, run_code, run_type, experiment_id, food_item_id, device_id, start_utc, status)
    VALUES (1, 'RUN-2026-001', 'training', 1, 1, 'ESP32-TEST-MAC', ?, 'active')
""",
    (now_epoch - 86400,),
)  # Started 24 hours ago

# 6. Associate any existing unassigned test readings with this run
cursor.execute("UPDATE readings SET run_id = 1 WHERE run_id IS NULL")

# 7. Generate 24 hours of fake sensor readings (logged every 15 minutes = 96 records)
start_time = now_epoch - 86400
co2_val = 400.0
ethylene_val = 0.05
temp_val = 21.0
humidity_val = 50.0

for step in range(96):
  ts = start_time + (step * 900)  # 15 minutes = 900 seconds

  # Simulate natural gas buildup as food ripens over 24h
  co2_val += random.uniform(1.0, 8.0)
  ethylene_val += random.uniform(0.001, 0.01)
  temp_val += random.uniform(-0.2, 0.2)
  humidity_val += random.uniform(-0.1, 0.3)

  readings = [
      (1, "ESP32-TEST-MAC", ts, ts, "co2", round(co2_val, 2), "SCD30"),
      (
          1,
          "ESP32-TEST-MAC",
          ts,
          ts,
          "ethylene",
          round(ethylene_val, 4),
          "SPEC-C2H4",
      ),
      (
          1,
          "ESP32-TEST-MAC",
          ts,
          ts,
          "temperature",
          round(temp_val, 1),
          "SHT31",
      ),
      (
          1,
          "ESP32-TEST-MAC",
          ts,
          ts,
          "humidity",
          round(humidity_val, 1),
          "SHT31",
      ),
  ]

  cursor.executemany(
      """
        INSERT OR IGNORE INTO readings (run_id, device_id, device_ts, server_ts, metric, value, sensor)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """,
      readings,
  )

conn.commit()
conn.close()
print(" Successfully generated 24 hours of test readings into spoilage.db!")