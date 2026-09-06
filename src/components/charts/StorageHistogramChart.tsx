"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "./ChartCard";

export default function StorageHistogramChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ChartCard
      title="Сколько партий сколько дней хранится"
      description="Распределение активных партий по числу дней с даты сбора"
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
          <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={30} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value}`, "Партий"]} />
          <Bar dataKey="count" fill={CHART_COLORS.series1} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
