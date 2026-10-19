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
import { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";
import KpiTile from "@/components/KpiTile";
import CardTabs from "@/components/CardTabs";
import Pager, { pageSlice } from "@/components/Pager";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
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
  const [view, setView] = useState<"orders" | "managers" | "hours">("orders");
  const [page, setPage] = useState(0);

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

  const shownOrders = pageSlice(snapshot.orders, page);

  const dateControl = (
    <>
      {snapshot.isToday && (
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-status-good opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-status-good" />
          </span>
          живое
        </span>
      )}
      {loading && <span className="text-ink-muted">обновляю…</span>}
      {error && <span className="text-status-critical">{error}</span>}
      <input
        type="date"
        className="input !w-auto !py-1.5"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setPage(0);
          load(e.target.value);
        }}
      />
    </>
  );

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="chart"
          label={`Продано · ${snapshot.dateLabel}`}
          value={money(t.amount)}
          hint={
            t.prevAmount > 0
              ? `${t.changePercent >= 0 ? "▲" : "▼"} ${Math.abs(t.changePercent).toFixed(0)}% к прошлому дню`
              : undefined
          }
          tone={t.prevAmount > 0 ? (t.changePercent >= 0 ? "good" : "bad") : undefined}
        />
        <KpiTile icon="leaf" label="Стеблей" value={t.stems.toLocaleString("ru-RU")} hint="во всех заявках дня" />
        <KpiTile icon="order" label="Заявок" value={String(t.orders)} hint={`${snapshot.managers.length} менеджеров`} />
        <KpiTile icon="wallet" label="Средний чек" value={t.orders > 0 ? money(t.avgOrder) : "—"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3 items-start">
        <div className="card !p-0 overflow-hidden xl:col-span-2">
          <CardTabs
            tone="sales"
            items={[
              { key: "orders", label: `Заявки дня (${snapshot.orders.length})` },
              { key: "managers", label: "Кто сколько продал" },
              { key: "hours", label: "По часам" },
            ]}
            value={view}
            onChange={setView}
            right={dateControl}
          />
          {t.orders === 0 ? (
            <div className="text-center py-14">
              <div className="text-2xl mb-2">🌤</div>
              <p className="font-medium">За этот день заявок нет</p>
            </div>
          ) : view === "orders" ? (
            <>
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={clsx(TH, "w-16")}>Время</th>
                      <th className={TH}>Клиент</th>
                      <th className={TH}>Менеджер</th>
                      <th className={TH}>Состав</th>
                      <th className={clsx(TH, "text-right")}>Шт.</th>
                      <th className={clsx(TH, "text-right")}>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownOrders.map((o) => (
                      <tr key={o.orderId} className={TR}>
                        <td data-label="Время" className="px-4 py-2.5 tabular-nums text-ink-secondary">{o.time}</td>
                        <td className="px-4 py-2.5 font-semibold max-w-[220px] truncate" title={o.clientName}>
                          {o.clientName}
                        </td>
                        <td data-label="Менеджер" className="px-4 py-2.5 whitespace-nowrap">{o.managerName}</td>
                        <td data-label="Состав" className="px-4 py-2.5 text-ink-secondary max-w-xs truncate" title={o.positions}>
                          {o.positions}
                        </td>
                        <td data-label="Шт." className="px-4 py-2.5 text-right tabular-nums">{o.stems.toLocaleString("ru-RU")}</td>
                        <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
                          {money(o.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager total={snapshot.orders.length} page={page} onPage={setPage} what="заявок" />
            </>
          ) : view === "managers" ? (
            <div className="p-4 sm:p-5" style={{ width: "100%", height: Math.max(220, managerChart.length * 40 + 40) }}>
              <ResponsiveContainer>
                <BarChart data={managerChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickFormatter={shortMoney} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={110} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), "Продано"]} />
                  <Bar dataKey="amount" fill={CHART_COLORS.series1} radius={[0, 4, 4, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-4 sm:p-5" style={{ width: "100%", height: 280 }}>
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
            </div>
          )}
        </div>

        <div className="card !p-4 sm:!p-5">
          <h3 className="font-display text-[15px] font-bold mb-3">Что продавали</h3>
          {t.orders === 0 ? (
            <p className="text-sm text-ink-muted">Пока нечего показать.</p>
          ) : (
            <>
              {snapshot.byFarm.length > 1 && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {snapshot.byFarm.map((f) => (
                    <div key={f.farm} className="rounded-xl bg-surface-plane px-3 py-2.5">
                      <div className="text-xs text-ink-muted truncate">{farmLabel(f.farm)}</div>
                      <div className="font-display font-extrabold tabular-nums mt-0.5">{money(f.amount)}</div>
                      <div className="text-xs text-ink-muted tabular-nums">{Math.round(f.share)}%</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {snapshot.byFlowerType.map((row) => (
                  <div key={row.flowerType}>
                    <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: TYPE_COLOR[row.flowerType] ?? CHART_COLORS.series1 }}
                        />
                        {FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        <b>{money(row.amount)}</b>
                        <span className="text-ink-muted"> · {row.stems.toLocaleString("ru-RU")} шт.</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-sunk overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${row.share}%`, background: TYPE_COLOR[row.flowerType] ?? CHART_COLORS.series1 }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mt-5 mb-2">Топ сортов дня</div>
              <div className="divide-y divide-line-hairline">
                {snapshot.varieties.slice(0, 6).map((v) => (
                  <div key={v.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5 text-sm">
                    <span className="truncate">
                      <b>{v.variety}</b> <span className="text-ink-secondary">{formatGrade(v.grade)}</span>
                      <span className="text-ink-muted"> · {FLOWER_TYPE_LABELS[v.flowerType]}</span>
                    </span>
                    <span className="tabular-nums whitespace-nowrap">{v.stems.toLocaleString("ru-RU")} шт.</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
