"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "./ChartCard";
import type { WriteoffSummary } from "@/lib/analytics";

export default function WriteoffsChart({ data }: { data: WriteoffSummary }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <ChartCard title="Списания по причинам" description="Количество стеблей, списанных как порча/брак/просрочка">
        <ResponsiveContainer>
          <BarChart data={data.byReason.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
            <XAxis type="number" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} allowDecimals={false} />
            <YAxis type="category" dataKey="reason" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={140} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} шт.`, "Списано"]} />
            <Bar dataKey="quantity" fill={CHART_COLORS.series8} radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Списания по месяцам" description="Динамика потерь во времени">
        <ResponsiveContainer>
          <BarChart data={data.byMonth} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
            <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={30} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} шт.`, "Списано"]} />
            <Bar dataKey="quantity" fill={CHART_COLORS.series8} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
