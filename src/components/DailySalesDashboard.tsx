"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";
import { FLOWER_TYPE_LABELS, farmLabel, formatGrade } from "@/lib/constants";
import type { DailySalesSnapshot } from "@/lib/dailySales";

const REFRESH_MS = 30_000;

const TYPE_COLOR: Record<string, string> = {
  rose: CHART_COLORS.series1,
  chrysanthemum: CHART_COLORS.series2,
  eustoma: CHART_COLORS.series3,
};

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

function shortMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} тыс.`;
  return String(Math.round(value));
}

export default function DailySalesDashboard({ initial }: { initial: DailySalesSnapshot }) {
  const [snapshot, setSnapshot] = useState<DailySalesSnapshot>(initial);
  const [date, setDate] = useState(initial.date);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetDate: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sales/day?date=${targetDate}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось загрузить продажи");
      setSnapshot((await res.json()) as DailySalesSnapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => load(date), REFRESH_MS);
    const onFocus = () => load(date);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, date]);

  const t = snapshot.totals;
  const managerChart = snapshot.managers.map((m) => ({ name: m.name, amount: m.amount }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            type="date"
            className="input !w-auto !py-1.5"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              load(e.target.value);
            }}
          />
          <span className="text-sm text-ink-secondary">{snapshot.dateLabel}</span>
          {snapshot.isToday && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-status-good opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-status-good" />
              </span>
              обновляется автоматически
            </span>
          )}
          {loading && <span className="text-sm text-ink-muted">обновляю…</span>}
          {error && <span className="text-sm text-status-critical">{error}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Продано за день</div>
          <div className="text-2xl font-semibold tabular-nums">{money(t.amount)}</div>
          {t.prevAmount > 0 && (
            <div
              className={clsx(
                "text-xs mt-1 tabular-nums",
                t.changePercent >= 0 ? "text-status-good" : "text-status-critical"
              )}
            >
              {t.changePercent >= 0 ? "▲" : "▼"} {Math.abs(t.changePercent).toFixed(0)}% к прошлому дню
            </div>
          )}
        </div>
        <Tile label="Стеблей" value={t.stems.toLocaleString("ru-RU")} sub="во всех заявках дня" />
        <Tile label="Заявок" value={String(t.orders)} sub={`${snapshot.managers.length} менеджеров`} />
        <Tile label="Средний чек" value={t.orders > 0 ? money(t.avgOrder) : "—"} />
      </div>

      {t.orders === 0 ? (
        <div className="card text-center py-12">
          <div className="text-2xl mb-2">🌤</div>
          <p className="font-medium">За этот день заявок пока нет</p>
          <p className="text-sm text-ink-secondary mt-1">
            Как только менеджер оформит заявку, она появится здесь автоматически.
          </p>
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Кто сколько продал" description="Сумма заявок за день по менеджерам" height={240}>
              <ResponsiveContainer>
                <BarChart data={managerChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickFormatter={shortMoney} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                    width={110}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), "Продано"]} />
                  <Bar dataKey="amount" fill={CHART_COLORS.series1} radius={[0, 4, 4, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="card">
              <h3 className="font-medium mb-1">Что продавали</h3>
              <p className="text-xs text-ink-muted mb-3">Доля выручки по типам цветка</p>

              {snapshot.byFarm.length > 1 && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm mb-3 pb-3 border-b border-line-hairline">
                  {snapshot.byFarm.map((f) => (
                    <span key={f.farm} className="flex items-baseline gap-1.5">
                      <span className="text-ink-secondary">{farmLabel(f.farm)}:</span>
                      <b className="tabular-nums">{money(f.amount)}</b>
                      <span className="text-ink-muted text-xs tabular-nums">
                        {Math.round(f.share)}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {snapshot.byFlowerType.map((row) => (
                  <div key={row.flowerType}>
                    <div className="flex items-baseline justify-between text-sm mb-1">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: TYPE_COLOR[row.flowerType] ?? CHART_COLORS.series1 }}
                        />
                        {FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType}
                      </span>
                      <span className="tabular-nums">
                        <b>{money(row.amount)}</b>
                        <span className="text-ink-muted"> · {row.stems.toLocaleString("ru-RU")} шт.</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-plane overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${row.share}%`,
                          background: TYPE_COLOR[row.flowerType] ?? CHART_COLORS.series1,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="font-medium mt-5 mb-2">Топ сортов дня</h3>
              <div className="space-y-1.5">
                {snapshot.varieties.slice(0, 6).map((v) => (
                  <div key={v.key} className="flex items-baseline justify-between text-sm">
                    <span className="truncate">
                      <span className="text-ink-muted">{FLOWER_TYPE_LABELS[v.flowerType]}</span>{" "}
                      <b>{v.variety}</b>{" "}
                      <span className="text-ink-secondary">{formatGrade(v.grade)}</span>
                    </span>
                    <span className="tabular-nums shrink-0 ml-3">
                      {v.stems.toLocaleString("ru-RU")} шт.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <ChartCard title="Продажи по часам" description="В какое время дня оформляются заявки" height={200}>
            <ResponsiveContainer>
              <BarChart data={snapshot.hourly} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
                <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={54} tickFormatter={shortMoney} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), "Продано"]} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={26}>
                  {snapshot.hourly.map((point) => (
                    <Cell key={point.hour} fill={point.amount > 0 ? CHART_COLORS.series1 : CHART_COLORS.grid} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div>
            <h3 className="font-medium mb-2">Заявки дня</h3>
            <div className="card !p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-secondary border-b border-line-hairline">
                    <th className="px-4 py-3 font-medium">Время</th>
                    <th className="px-4 py-3 font-medium">Менеджер</th>
                    <th className="px-4 py-3 font-medium">Клиент</th>
                    <th className="px-4 py-3 font-medium">Состав</th>
                    <th className="px-4 py-3 font-medium text-right">Шт.</th>
                    <th className="px-4 py-3 font-medium text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.orders.map((o) => (
                    <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                      <td className="px-4 py-2.5 tabular-nums text-ink-secondary">{o.time}</td>
                      <td className="px-4 py-2.5">{o.managerName}</td>
                      <td className="px-4 py-2.5 font-medium">{o.clientName}</td>
                      <td className="px-4 py-2.5 text-ink-secondary max-w-xs truncate" title={o.positions}>
                        {o.positions}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.stems.toLocaleString("ru-RU")}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card !p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
