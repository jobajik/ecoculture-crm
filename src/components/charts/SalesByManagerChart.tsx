"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "./ChartCard";
import type { SalesByManagerRow } from "@/lib/analytics";

export default function SalesByManagerChart({ data }: { data: SalesByManagerRow[] }) {
  const top = data.slice(0, 10);
  return (
    <ChartCard title="Выручка по менеджерам" description="Сумма заявок (кроме отменённых) по менеджеру, оформившему заявку">
      <ResponsiveContainer>
        <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
          <XAxis type="number" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
          <YAxis
            type="category"
            dataKey="managerEmail"
            tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
            width={140}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [`${Math.round(value).toLocaleString("ru-RU")} ₸`, "Выручка"]}
          />
          <Bar dataKey="totalAmount" fill={CHART_COLORS.series1} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
