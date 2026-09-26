import CO2Chart from "@/components/CO2Chart";
import EthyleneChart from "@/components/EthyleneChart";
import TemperatureChart from "@/components/TemperatureChart";
import HumidityChart from "@/components/HumidityChart";
import MethaneChart from "@/components/MethaneChart";
import { getDb } from "@/lib/mongodb";

interface Reading {
  metric: string;
  value: number;
  unit: string;
}

interface SensorDoc {
  ts: number;
  data: Reading[];
}

// Shape of the raw document as stored in MongoDB (has _id + nested data field)
interface MongoDoc {
  _id: unknown;
  data: SensorDoc;
}

interface TableRow {
  time: string;
  value: string;
  sensor: string;
}

interface ChartPoint {
  time: string;
  value: number;
}

// Converts a unix epoch timestamp (in seconds) into a readable time string, e.g. "14:32"
function formatTime(ts: number): string {
  const date = new Date(ts * 1000); // seconds -> milliseconds
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function extractMetricReadings(
  docs: SensorDoc[],
  metricName: string,
  sensorLabel: string
): TableRow[] {
  const rows: TableRow[] = [];

  for (const doc of docs) {
    const match = doc.data?.find((d) => d.metric === metricName);
    if (match) {
      rows.push({
        time: formatTime(doc.ts),
        value: `${match.value} ${match.unit}`,
        sensor: sensorLabel,
      });
    }
    if (rows.length >= 5) break;
  }

  return rows;
}

function extractChartData(docs: SensorDoc[], metricName: string): ChartPoint[] {
  return docs
    .filter((doc) => doc.data?.some((d) => d.metric === metricName))
    .map((doc) => {
      const match = doc.data.find((d) => d.metric === metricName)!;
      return {
        time: formatTime(doc.ts),
        value: match.value,
      };
    })
    .reverse(); // docs come sorted newest-first; charts read left-to-right oldest-first
}

async function getAllReadings() {
  const db = await getDb();
  const rawDocs = (await db
    .collection("DIRT")
    .find({})
    .sort({ "data.ts": -1 })
    .limit(50)
    .toArray()) as unknown as MongoDoc[];

  // Unwrap the nested `data` field so downstream functions work with plain SensorDoc[]
  const docs: SensorDoc[] = rawDocs.map((raw) => raw.data);

  return {
    co2Table: extractMetricReadings(docs, "co2", "SCD30"),
    co2Chart: extractChartData(docs, "co2"),
    ethyleneTable: extractMetricReadings(docs, "ethylene", "SPEC-C2H4"),
    ethyleneChart: extractChartData(docs, "ethylene"),
    temperatureTable: extractMetricReadings(docs, "temperature", "SHT31"),
    temperatureChart: extractChartData(docs, "temperature"),
    humidityTable: extractMetricReadings(docs, "humidity", "SHT31"),
    humidityChart: extractChartData(docs, "humidity"),
    methaneTable: extractMetricReadings(docs, "methane", "MQ4"),
    methaneChart: extractChartData(docs, "methane"),
  };
}

function RecentReadingsTable({
  readings,
}: {
  readings: {
    time: string;
    value: string;
    sensor: string;
  }[];
}) {
  return (
    <div className="recent-table">
      <div className="recent-table-header">
        <h3>Recent Readings</h3>
        <span>Last 5 measurements</span>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Value</th>
              <th>Sensor</th>
            </tr>
          </thead>

          <tbody>
            {readings.map((reading, index) => (
              <tr key={index}>
                <td>{reading.time}</td>
                <td className="reading-value">{reading.value}</td>
                <td>{reading.sensor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function Home() {
  const {
    co2Table,
    co2Chart,
    ethyleneTable,
    ethyleneChart,
    temperatureTable,
    temperatureChart,
    humidityTable,
    humidityChart,
    methaneTable,
    methaneChart,
  } = await getAllReadings();

  return (
    <main>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">DIRT Spoilage Monitor</h1>
          <p className="dashboard-subtitle">
            Real-time environmental monitoring
          </p>
        </div>

        <div className="status">System Online</div>
      </header>

      <section className="run-card">
        <p className="run-card-label">Current Monitoring Run</p>
        <h2>RUN-2026-001 — Banana</h2>
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>CO₂ Concentration</h2>
            <p>Carbon dioxide concentration over time</p>
          </div>
        </div>

        <CO2Chart data={co2Chart} />

        <RecentReadingsTable readings={co2Table} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Ethylene Concentration</h2>
            <p>Ethylene concentration over time</p>
          </div>
        </div>

        <EthyleneChart data={ethyleneChart} />

        <RecentReadingsTable readings={ethyleneTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Temperature</h2>
            <p>Chamber temperature over time</p>
          </div>
        </div>

        <TemperatureChart data={temperatureChart} />

        <RecentReadingsTable readings={temperatureTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Humidity</h2>
            <p>Relative humidity over time</p>
          </div>
        </div>

        <HumidityChart data={humidityChart} />

        <RecentReadingsTable readings={humidityTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Methane Concentration</h2>
            <p>Methane concentration over time</p>
          </div>
        </div>

        <MethaneChart data={methaneChart} />

        <RecentReadingsTable readings={methaneTable} />
      </section>
    </main>
  );
}