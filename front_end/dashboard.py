import sqlite3
import pandas as pd
import streamlit as st

st.set_page_config(
    page_title="DIRT Spoilage Monitor", layout="wide"
)

st.title("DIRT - Food Spoilage Monitor Dashboard")
st.markdown("---")

DB_PATH = "../spoilage-server/spoilage.db"


@st.cache_data(ttl=2)
def load_data():
  try:
    conn = sqlite3.connect(DB_PATH)

    tables = [
        t[0]
        for t in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table';"
        ).fetchall()
    ]

    if "readings" not in tables:
      conn.close()
      return None, None, "The 'readings' table does not exist in spoilage.db yet."

    runs_df = pd.read_sql_query(
        """
            SELECT r.id AS run_id, r.run_code, r.run_type, COALESCE(f.label, 'Unassigned') AS food_item, r.status
            FROM runs r
            LEFT JOIN food_items f ON r.food_item_id = f.id
        """,
        conn,
    )

    readings_df = pd.read_sql_query(
        """
            SELECT run_id, device_id, metric, value, datetime(server_ts, 'unixepoch', 'localtime') AS timestamp
            FROM readings
        """,
        conn,
    )

    conn.close()

    # Clean up X-axis timestamps into proper Datetime objects
    if not readings_df.empty:
      readings_df["timestamp"] = pd.to_datetime(readings_df["timestamp"])
      readings_df = readings_df.sort_values("timestamp")

    return runs_df, readings_df, None
  except Exception as e:
    return None, None, str(e)


runs_df, readings_df, error = load_data()

if error:
  st.warning(f"Database Notice: {error}")
  st.info(
      "Run `python seed_data.py` inside `spoilage-server/` to generate test"
      " records!"
  )

elif readings_df is None or readings_df.empty:
  st.info("Database connected. Waiting for incoming sensor readings...")

else:
  # Sidebar selection
  if not runs_df.empty:
    run_list = runs_df["run_code"].unique()
    selected_run_code = st.sidebar.selectbox("Select Monitoring Run", run_list)
    selected_run = runs_df[runs_df["run_code"] == selected_run_code].iloc[0]
    run_id = selected_run["run_id"]

    st.subheader(
        f"Active Run: {selected_run['run_code']} | Item:"
        f" {selected_run['food_item']} | Status: {selected_run['status'].upper()}"
    )
  else:
    run_id = None
    st.subheader("Displaying All Raw System Readings")

  # Filter data for selected run
  filtered = (
      readings_df[readings_df["run_id"] == run_id]
      if run_id
      else readings_df
  )

  if filtered.empty:
    st.info("No sensor readings logged for this specific run code yet.")
  else:
    # Summary Metric Cards with Subscript CO₂
    latest_readings = filtered.groupby("metric").last().reset_index()
    m_cols = st.columns(len(latest_readings))

    for idx, row in latest_readings.iterrows():
      metric_name = row["metric"].lower()

      if metric_name == "co2":
        display_label = "CO₂ (ppm)"
      elif metric_name == "ethylene":
        display_label = "Ethylene (ppm)"
      elif metric_name == "temperature":
        display_label = "Temperature (°C)"
      elif metric_name == "humidity":
        display_label = "Humidity (%RH)"
      else:
        display_label = metric_name.upper()

      with m_cols[idx]:
        st.metric(label=display_label, value=f"{row['value']}")

    st.markdown("---")

    # Pivot readings for time-series charts with timestamp index
    pivoted = filtered.pivot_table(
        index="timestamp", columns="metric", values="value", aggfunc="last"
    )

    col1, col2 = st.columns(2)

    with col1:
      if "co2" in pivoted.columns:
        st.markdown("### CO₂ Concentration (ppm)")
        st.line_chart(pivoted[["co2"]])

      if "ethylene" in pivoted.columns:
        st.markdown("### Ethylene (ppm)")
        st.line_chart(pivoted[["ethylene"]])

    with col2:
      if "temperature" in pivoted.columns:
        st.markdown("### Temperature (°C)")
        st.line_chart(pivoted[["temperature"]])

      if "humidity" in pivoted.columns:
        st.markdown("### Humidity (%RH)")
        st.line_chart(pivoted[["humidity"]])

    st.markdown("---")
    st.markdown("### Logged Sensor Data Stream")
    st.dataframe(filtered.tail(20), use_container_width=True)