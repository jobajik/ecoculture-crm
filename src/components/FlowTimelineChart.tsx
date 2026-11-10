"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";

/** «Срез · продажи · списания»: по дням или неделям — срезано, продано по заявкам, отгружено со склада, списано. */
export default function FlowTimelineChart({
  data,
  height = 280,
}: {
  data: { label: string; cut: number; sold: number; shipped: number; writeoff: number }[];
  height?: number;
}) {
  const nf = (v: number) => Math.round(v).toLocaleString("ru-RU");
  const many = data.length > 20;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={1}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: many ? 10 : 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} interval={many ? "preserveStartEnd" : 0} />
          <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)} тыс` : String(v))} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${nf(Number(v))} шт.`, String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="cut" name="Срезано" fill={CHART_COLORS.series3} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="sold" name="Продано по заявкам" fill={CHART_COLORS.series1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="shipped" name="Отгружено со склада" fill={CHART_COLORS.series7} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="writeoff" name="Списано" fill={CHART_COLORS.series8} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
