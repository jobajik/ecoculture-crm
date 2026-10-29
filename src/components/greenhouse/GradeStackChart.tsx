"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";
import { GRADE_COLORS } from "@/lib/greenhouse/views";

/** Срезка столбиками со стопкой категорий — по дням блока или по неделям/месяцам в аналитике. */
export default function GradeStackChart({ data, grades, height = 240, colors = GRADE_COLORS }: { data: ({ label: string } & Record<string, number | string>)[]; grades: string[]; height?: number; colors?: Record<string, string> }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} minTickGap={12} />
          <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v, name) => [`${Number(v).toLocaleString("ru-RU")} шт.`, String(name)]} />
          {grades.map((g, i) => (
            <Bar key={g} dataKey={g} stackId="g" fill={colors[g] ?? "#bbb"} radius={i === grades.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
