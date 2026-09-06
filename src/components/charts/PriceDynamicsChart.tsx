"use client";

import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CATEGORICAL_ORDER, CHART_COLORS, tooltipStyle } from "./ChartCard";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { PricePointRow } from "@/lib/analytics";

const MAX_SERIES = 6;

export default function PriceDynamicsChart({ data }: { data: PricePointRow[] }) {
  const { rows, seriesKeys, seriesLabels } = useMemo(() => {
    const countByKey = new Map<string, number>();
    for (const p of data) countByKey.set(p.key, (countByKey.get(p.key) ?? 0) + 1);

    const topKeys = Array.from(countByKey.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SERIES)
      .map(([key]) => key);
    const topKeySet = new Set(topKeys);

    const labels: Record<string, string> = {};
    for (const p of data) {
      if (topKeySet.has(p.key) && !labels[p.key]) {
        labels[p.key] = `${FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType} ${p.variety}`;
      }
    }

    const byDate = new Map<string, Record<string, number | string>>();
    for (const p of data) {
      if (!topKeySet.has(p.key)) continue;
      const row = byDate.get(p.date) ?? { date: p.date };
      row[p.key] = p.price;
      byDate.set(p.date, row);
    }

    const sortedRows = Array.from(byDate.values()).sort((a, b) =>
      (a.date as string) < (b.date as string) ? -1 : 1
    );

    return { rows: sortedRows, seriesKeys: topKeys, seriesLabels: labels };
  }, [data]);

  if (seriesKeys.length === 0) {
    return (
      <ChartCard title="Динамика цен" description="Появится после первых оформленных заявок">
        <div className="h-full flex items-center justify-center text-ink-muted text-sm">Пока нет данных</div>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Динамика цен по сортам"
      description={`Цена за штуку в заявках, топ-${seriesKeys.length} сортов по числу заявок`}
      height={320}
    >
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
            tickFormatter={(v: string) => new Date(v).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
          />
          <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={45} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(v: string) => new Date(v).toLocaleDateString("ru-RU")}
            formatter={(value: number, key: string) => [`${value.toLocaleString("ru-RU")} ₸`, seriesLabels[key] ?? key]}
          />
          <Legend
            formatter={(key: string) => seriesLabels[key] ?? key}
            wrapperStyle={{ fontSize: 12 }}
          />
          {seriesKeys.map((key, idx) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CATEGORICAL_ORDER[idx % CATEGORICAL_ORDER.length]}
              strokeWidth={2}
              dot={{ r: 2.5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
