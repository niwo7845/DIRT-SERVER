
"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface CO2DataPoint {
  time: string;
  value: number;
}

export default function CO2Chart({ data }: { data: CO2DataPoint[] }) {
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
            value: "CO₂ (ppm)",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
          }}
        />

        <Tooltip />

        <Line
          type="monotone"
          dataKey="value"
          stroke="#22c55e"
          strokeWidth={3}
        />
      </LineChart>
    </div>
  );
}