
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
  { time: "08:00", value: 0.05 },
  { time: "08:15", value: 0.06 },
  { time: "08:30", value: 0.07 },
  { time: "08:45", value: 0.08 },
  { time: "09:00", value: 0.09 },
];

export default function EthyleneChart() {
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
            value: "Ethylene (ppm)",
            angle: -90,
            position: "insideLeft",
            offset: 10,
            style: { textAnchor: "middle" },
        }}
        />

        <Tooltip />

        <Line
          type="monotone"
          dataKey="value"
          stroke="#f59e0b"
          strokeWidth={3}
        />
      </LineChart>
    </div>
  );
}

