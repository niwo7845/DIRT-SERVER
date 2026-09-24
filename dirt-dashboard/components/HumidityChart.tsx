
"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const data = [
  { time: "08:00", value: 50 },
  { time: "08:15", value: 51 },
  { time: "08:30", value: 53 },
  { time: "08:45", value: 54 },
  { time: "09:00", value: 56 },
];

export default function HumidityChart() {
  return (
    <div style={{ width: "100%", height: 350 }}>
      <LineChart
        width={800}
        height={350}
        data={data}
        margin={{ top: 10, right: 30, left: 30, bottom: 30 }}
      >
        <CartesianGrid strokeDasharray="3 3" />

        <XAxis
          dataKey="time"
          label={{
            value: "Time",
            position: "insideBottom",
            offset: -5,
          }}
        />

        <YAxis
        width={90}
        label={{
            value: "Humidity (%RH)",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
        }}
        />

        <Tooltip />

        <Line
          type="monotone"
          dataKey="value"
          stroke="#8b5cf6"
          strokeWidth={3}
        />
      </LineChart>
    </div>
  );
}

