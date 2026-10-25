
import MetricChart from "@/components/MetricChart";
import { Sample, compressSamples } from "@/lib/metrics";
import ActiveCollectionControl from "@/components/ActiveCollectionControl";
import ViewCollectionSelector from "@/components/ViewCollectionSelector";
import { getDb } from "@/lib/mongodb";
import { getActiveCollection, getDataCollections, DEFAULT_COLLECTION, NO_RECORD } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_DOCS = 50000; // most documents to read per page load (~5 weeks at 1/min)

interface Reading {
  metric: string;
  value: number;
  unit: string;
}

interface SensorDoc {
  ts: number;
  data: Reading[];
}

interface MongoDoc {
  _id: unknown;
  data: SensorDoc;
}

interface TableRow {
  time: string;
  value: string;
  sensor: string;
}

function formatTime(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Denver",
  });
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

function flattenDocs(docs: SensorDoc[]): Sample[] {
  return docs
    .map((doc) => {
      const sample: Sample = { ts: doc.ts };
      for (const reading of doc.data ?? []) {
        sample[reading.metric] = reading.value;
      }
      return sample;
    })
    .reverse(); // docs arrive newest-first; charts want oldest-first
}


async function getAllReadings(collectionName: string) {
  const db = await getDb();
  const rawDocs = (await db
    .collection(collectionName)
    .find({})
    .sort({ "data.ts": -1 })
    .limit(MAX_DOCS)
    .toArray()) as unknown as MongoDoc[];

  const docs: SensorDoc[] = rawDocs.map((raw) => raw.data);

  return {
    samples: compressSamples(flattenDocs(docs)),
    co2Table: extractMetricReadings(docs, "co2", "SCD30"),
    ethyleneTable: extractMetricReadings(docs, "ethylene", "SPEC-C2H4"),
    temperatureTable: extractMetricReadings(docs, "temperature", "SHT31"),
    humidityTable: extractMetricReadings(docs, "humidity", "SHT31"),
    methaneTable: extractMetricReadings(docs, "methane", "MQ4"),
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const activeCollection = await getActiveCollection(); // where the ESP32 is writing, or NO_RECORD
  const recording = activeCollection !== NO_RECORD;
  const collections = await getDataCollections();

  // Which run is being displayed: ?view=... if valid, otherwise follow the ESP32's collection
  // (or the first existing collection when nothing is being recorded)
  const viewedCollection =
    params.view && collections.includes(params.view)
      ? params.view
      : recording
        ? activeCollection
        : collections[0] ?? DEFAULT_COLLECTION;

  const viewOptions = Array.from(new Set([...collections, viewedCollection]));
  const recordOptions = recording
    ? Array.from(new Set([...collections, activeCollection]))
    : collections;

  const {
    samples,
    co2Table,
    ethyleneTable,
    temperatureTable,
    humidityTable,
    methaneTable,
  } = await getAllReadings(viewedCollection);

  return (
    <main>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">DIRT Spoilage Monitor</h1>
          <p className="dashboard-subtitle">
            Real-time environmental monitoring
          </p>
        </div>
      </header>

      <section className="run-card">
        <div>
          <p className="run-card-label">Currently Viewing</p>
          <h2>{viewedCollection}</h2>
          <ViewCollectionSelector
            collections={viewOptions}
            selected={viewedCollection}
          />
        </div>
        <div style={{background: recording ? "#ff696987" : "#94a3b833", borderRadius: "16px", padding:"15px"}}>
          <p className="run-card-label">Push Data To</p>
          <h2>{recording ? activeCollection : "Not recording"}</h2>
          <ActiveCollectionControl
            currentCollection={activeCollection}
            collections={recordOptions}
          />
        </div>
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>CO₂ Concentration</h2>
            <p>Carbon dioxide concentration over time</p>
          </div>
        </div>

        <MetricChart data={samples} yKey="co2" />

        <RecentReadingsTable readings={co2Table} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Ethylene Concentration</h2>
            <p>Ethylene concentration over time</p>
          </div>
        </div>

        <MetricChart data={samples} yKey="ethylene" />

        <RecentReadingsTable readings={ethyleneTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Temperature</h2>
            <p>Chamber temperature over time</p>
          </div>
        </div>

        <MetricChart data={samples} yKey="temperature" />

        <RecentReadingsTable readings={temperatureTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Humidity</h2>
            <p>Relative humidity over time</p>
          </div>
        </div>

        <MetricChart data={samples} yKey="humidity" />

        <RecentReadingsTable readings={humidityTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Methane Concentration</h2>
            <p>Methane concentration over time</p>
          </div>
        </div>

        <MetricChart data={samples} yKey="methane" />

        <RecentReadingsTable readings={methaneTable} />
      </section>
    </main>
  );
}