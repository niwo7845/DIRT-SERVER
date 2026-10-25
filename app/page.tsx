import Link from "next/link";
import MetricChart from "@/components/MetricChart";
import ActiveCollectionControl from "@/components/ActiveCollectionControl";
import ViewCollectionSelector from "@/components/ViewCollectionSelector";
import { SensorDoc, getSensorDocs, toSamples } from "@/lib/readings";
import { getMetric } from "@/lib/metrics";
import { getAnnotation } from "@/lib/annotationStore";
import { TIME_ZONE } from "@/lib/time";
import { getActiveCollection, getDataCollections, resolveViewedCollection, NO_RECORD } from "@/lib/config";

export const dynamic = "force-dynamic";

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
    timeZone: TIME_ZONE,
  });
}

function extractMetricReadings(
  docs: SensorDoc[],
  metricName: string,
  sensorLabel: string
): TableRow[] {
  const rows: TableRow[] = [];

  // The device's own unit strings are raw ("C", "percent"), so display the
  // registry's instead to match the chart axes.
  const unit = getMetric(metricName).unit;

  for (const doc of docs) {
    const match = doc.data?.find((d) => d.metric === metricName);
    if (match) {
      rows.push({
        time: formatTime(doc.ts),
        value: `${match.value} ${unit}`,
        sensor: sensorLabel,
      });
    }
    if (rows.length >= 5) break;
  }
  return rows;
}

async function getAllReadings(collectionName: string) {
  const docs = await getSensorDocs(collectionName);

  return {
    samples: toSamples(docs),
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

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : undefined;

  const activeCollection = await getActiveCollection(); // where the ESP32 is writing, or NO_RECORD
  const recording = activeCollection !== NO_RECORD;
  const collections = await getDataCollections();

  const viewedCollection = resolveViewedCollection(view, collections, activeCollection);

  const viewOptions = Array.from(new Set([...collections, viewedCollection]));
  const recordOptions = recording
    ? Array.from(new Set([...collections, activeCollection]))
    : collections;

  const annotation = await getAnnotation(viewedCollection);

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

        <Link
          href={`/annotate?view=${encodeURIComponent(viewedCollection)}`}
          className="nav-button"
        >
          Annotate data →
        </Link>
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

        <MetricChart annotations={annotation} data={samples} yKey="co2" />

        <RecentReadingsTable readings={co2Table} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Ethylene Concentration</h2>
            <p>Ethylene concentration over time</p>
          </div>
        </div>

        <MetricChart annotations={annotation} data={samples} yKey="ethylene" />

        <RecentReadingsTable readings={ethyleneTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Temperature</h2>
            <p>Chamber temperature over time</p>
          </div>
        </div>

        <MetricChart annotations={annotation} data={samples} yKey="temperature" />

        <RecentReadingsTable readings={temperatureTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Humidity</h2>
            <p>Relative humidity over time</p>
          </div>
        </div>

        <MetricChart annotations={annotation} data={samples} yKey="humidity" />

        <RecentReadingsTable readings={humidityTable} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Methane Concentration</h2>
            <p>Methane concentration over time</p>
          </div>
        </div>

        <MetricChart annotations={annotation} data={samples} yKey="methane" />

        <RecentReadingsTable readings={methaneTable} />
      </section>
    </main>
  );
}