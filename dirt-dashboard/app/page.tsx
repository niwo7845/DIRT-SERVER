
import CO2Chart from "@/components/CO2Chart";
import EthyleneChart from "@/components/EthyleneChart";
import TemperatureChart from "@/components/TemperatureChart";
import HumidityChart from "@/components/HumidityChart";

const co2Readings = [
  { time: "09:00", value: "560 ppm", sensor: "SCD30" },
  { time: "08:45", value: "510 ppm", sensor: "SCD30" },
  { time: "08:30", value: "470 ppm", sensor: "SCD30" },
  { time: "08:15", value: "440 ppm", sensor: "SCD30" },
  { time: "08:00", value: "420 ppm", sensor: "SCD30" },
];

const ethyleneReadings = [
  { time: "09:00", value: "0.09 ppm", sensor: "SPEC-C2H4" },
  { time: "08:45", value: "0.08 ppm", sensor: "SPEC-C2H4" },
  { time: "08:30", value: "0.07 ppm", sensor: "SPEC-C2H4" },
  { time: "08:15", value: "0.06 ppm", sensor: "SPEC-C2H4" },
  { time: "08:00", value: "0.05 ppm", sensor: "SPEC-C2H4" },
];

const temperatureReadings = [
  { time: "09:00", value: "22.4 °C", sensor: "SHT31" },
  { time: "08:45", value: "22.0 °C", sensor: "SHT31" },
  { time: "08:30", value: "21.6 °C", sensor: "SHT31" },
  { time: "08:15", value: "21.2 °C", sensor: "SHT31" },
  { time: "08:00", value: "21.0 °C", sensor: "SHT31" },
];

const humidityReadings = [
  { time: "09:00", value: "56 %RH", sensor: "SHT31" },
  { time: "08:45", value: "54 %RH", sensor: "SHT31" },
  { time: "08:30", value: "53 %RH", sensor: "SHT31" },
  { time: "08:15", value: "51 %RH", sensor: "SHT31" },
  { time: "08:00", value: "50 %RH", sensor: "SHT31" },
];

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

export default function Home() {
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

        <CO2Chart />

        <RecentReadingsTable readings={co2Readings} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Ethylene Concentration</h2>
            <p>Ethylene concentration over time</p>
          </div>
        </div>

        <EthyleneChart />

        <RecentReadingsTable readings={ethyleneReadings} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Temperature</h2>
            <p>Chamber temperature over time</p>
          </div>
        </div>

        <TemperatureChart />

        <RecentReadingsTable readings={temperatureReadings} />
      </section>

      <section className="chart-card">
        <div className="chart-header">
          <div>
            <h2>Humidity</h2>
            <p>Relative humidity over time</p>
          </div>
        </div>

        <HumidityChart />

        <RecentReadingsTable readings={humidityReadings} />
      </section>
    </main>
  );
}

