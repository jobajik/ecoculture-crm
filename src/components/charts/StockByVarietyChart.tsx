"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "./ChartCard";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { StockByVarietyRow } from "@/lib/analytics";

const FLOWER_COLOR: Record<string, string> = {
  rose: CHART_COLORS.series1,
  chrysanthemum: CHART_COLORS.series2,
};

export default function StockByVarietyChart({ data }: { data: StockByVarietyRow[] }) {
  const top = data.slice(0, 12);

  return (
    <ChartCard
      title="Остатки на складе по сортам"
      description="Количество стеблей в доступных партиях (не списанных и не отгруженных)"
    >
      <div className="flex items-center gap-4 text-xs text-ink-secondary mb-2">
        {Object.entries(FLOWER_TYPE_LABELS).map(([key, label]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: FLOWER_COLOR[key] }} />
            {label}
          </span>
        ))}
      </div>
      <ResponsiveContainer>
        <BarChart data={top} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="variety"
            tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
            angle={-30}
            textAnchor="end"
            interval={0}
            height={50}
          />
          <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={40} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [`${value} шт.`, "Остаток"]}
          />
          <Bar dataKey="quantity" radius={[4, 4, 0, 0]} maxBarSize={36}>
            {top.map((row) => (
              <Cell key={row.key} fill={FLOWER_COLOR[row.flowerType] ?? CHART_COLORS.series1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
