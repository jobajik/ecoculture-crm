"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "./ChartCard";
import type { SalesWeekRow } from "@/lib/analytics";

function formatWeek(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export default function SalesByWeekCharts({ data }: { data: SalesWeekRow[] }) {
  const chartData = data.map((d) => ({ ...d, label: formatWeek(d.weekStart) }));

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <ChartCard title="Выручка по неделям" description="Сумма по всем заявкам (кроме отменённых), по дате оформления">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
            <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={50} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${Math.round(value).toLocaleString("ru-RU")} ₸`, "Выручка"]} />
            <Line type="monotone" dataKey="totalAmount" stroke={CHART_COLORS.series1} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Объём продаж по неделям" description="Количество стеблей во всех позициях заявок">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
            <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={40} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} шт.`, "Количество"]} />
            <Line type="monotone" dataKey="totalQuantity" stroke={CHART_COLORS.series3} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
