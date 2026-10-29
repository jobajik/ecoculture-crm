"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";

/** Выход и доля высшей + 1-й по завершённым циклам — две линии, в процентах. */
export default function CyclesTrendChart({ data, height = 260 }: { data: { label: string; yield: number | null; top: number | null }[]; height?: number }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
          <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={false} width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${Math.round(Number(v))} %`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="yield" name="Выход" stroke="#2c6e5a" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="top" name="Высшая и 1-я" stroke="#e2a13a" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
