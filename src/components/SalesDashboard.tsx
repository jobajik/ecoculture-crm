"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";
import { FARM_ORDER, FLOWER_TYPE_LABELS_PLURAL, farmLabel } from "@/lib/constants";
import type { ManagerSalesRow, SalesSnapshot } from "@/lib/salesAnalytics";

const FARM_COLOR: Record<string, string> = {
  [FARM_ORDER[0]]: CHART_COLORS.series1,
  [FARM_ORDER[1]]: CHART_COLORS.series2,
};

const REFRESH_MS = 60_000;

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

function shortMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} тыс.`;
  return String(Math.round(value));
}

function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function progressTone(percent: number, daysShare: number) {
  if (percent >= 100) return "good";
  // Отстаёт ли менеджер от равномерного темпа выполнения плана.
  if (percent >= daysShare * 100 - 10) return "ok";
  if (percent >= daysShare * 100 - 25) return "warning";
  return "critical";
}

const TONE_BAR: Record<string, string> = {
  good: "bg-status-good",
  ok: "bg-accent",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
};

const TONE_TEXT: Record<string, string> = {
  good: "text-status-good",
  ok: "text-accent",
  warning: "text-[#8a5a00]",
  critical: "text-status-critical",
};

export default function SalesDashboard({ initial }: { initial: SalesSnapshot }) {
  const [snapshot, setSnapshot] = useState<SalesSnapshot>(initial);
  const [period, setPeriod] = useState(initial.period);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPeriod: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sales?period=${nextPeriod}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось загрузить продажи");
      setSnapshot((await res.json()) as SalesSnapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => load(period), REFRESH_MS);
    return () => clearInterval(interval);
  }, [load, period]);

  const t = snapshot.totals;
  const daysShare = t.daysInMonth > 0 ? t.daysPassed / t.daysInMonth : 0;
  const tone = progressTone(t.progressPercent, daysShare);
  const hasPlan = t.targetAmount > 0;

  const dailyChartData = snapshot.daily.map((d) => ({
    ...d,
    label: String(Number(d.date.slice(8, 10))),
    cumulative: Number.isNaN(d.cumulative) ? null : d.cumulative,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            className="input !w-auto !py-1.5"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              load(e.target.value);
            }}
          >
            {snapshot.availablePeriods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          {loading && <span className="text-sm text-ink-muted">обновляю…</span>}
          {error && <span className="text-sm text-status-critical">{error}</span>}
        </div>
        <span className="text-sm text-ink-muted tabular-nums">
          День {t.daysPassed} из {t.daysInMonth}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Продано за месяц" value={money(t.amountMonth)} sub={`${t.ordersMonth} заявок · ${t.stemsMonth.toLocaleString("ru-RU")} шт.`} />
        <Tile label="План на месяц" value={hasPlan ? money(t.targetAmount) : "не задан"} sub={hasPlan ? `осталось ${money(Math.max(0, t.targetAmount - t.amountMonth))}` : "вкладка Plans в таблице"} />
        <Tile
          label="Выполнение плана"
          value={hasPlan ? `${t.progressPercent.toFixed(0)}%` : "—"}
          sub={hasPlan ? `прогноз ${money(t.forecastAmount)}` : undefined}
          tone={hasPlan ? tone : "default"}
        />
        <Tile label="Продано сегодня" value={money(t.amountToday)} sub={`${t.ordersToday} заявок`} />
      </div>

      {hasPlan && (
        <div className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h3 className="font-medium">План месяца</h3>
            <span className="text-sm text-ink-secondary tabular-nums">
              {money(t.amountMonth)} из {money(t.targetAmount)}
              {t.requiredPerDay > 0 && (
                <span className="text-ink-muted">
                  {" "}· нужно {money(t.requiredPerDay)}/день до конца месяца
                </span>
              )}
            </span>
          </div>
          <div className="relative h-3 rounded-full bg-surface-plane overflow-hidden">
            <div
              className={clsx("h-full rounded-full transition-all", TONE_BAR[tone])}
              style={{ width: `${Math.min(100, t.progressPercent)}%` }}
            />
            {/* Отметка равномерного темпа: где план должен быть на сегодня */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-ink-primary/50"
              style={{ left: `${Math.min(100, daysShare * 100)}%` }}
              title={`Ровный темп на сегодня: ${(daysShare * 100).toFixed(0)}%`}
            />
          </div>
          <div className="flex justify-between text-xs text-ink-muted mt-1.5">
            <span>0</span>
            <span>ровный темп на сегодня — {(daysShare * 100).toFixed(0)}%</span>
            <span>{shortMoney(t.targetAmount)}</span>
          </div>
        </div>
      )}

      {snapshot.byFlower.length > 0 && (
        <div className="card !p-0 overflow-x-auto">
          <div className="px-4 pt-4 pb-2">
            <h3 className="font-medium">План и факт по цветку</h3>
            <p className="text-xs text-ink-muted">
              План ставится отдельно по розам, хризантемам и эустоме. Считаются позиции заявок:
              в одной заявке едет и роза, и хризантема.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-y border-line-hairline">
                <th className="px-4 py-2 font-medium">Цветок</th>
                <th className="px-4 py-2 font-medium text-right">План</th>
                <th className="px-4 py-2 font-medium text-right">Продано</th>
                <th className="px-4 py-2 font-medium text-right">Выполнение</th>
                <th className="px-4 py-2 font-medium text-right">
                  Стебли
                  <div className="text-xs font-normal text-ink-muted">факт / план</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshot.byFlower.map((f) => {
                const tone =
                  f.progressPercent === null
                    ? "ok"
                    : progressTone(f.progressPercent, daysShare);
                return (
                  <tr key={f.flowerType} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                      {f.targetAmount > 0 ? money(f.targetAmount) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {money(f.amount)}
                    </td>
                    <td className={clsx("px-4 py-2 text-right tabular-nums", TONE_TEXT[tone])}>
                      {f.progressPercent === null ? "плана нет" : `${Math.round(f.progressPercent)}%`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                      {f.stems.toLocaleString("ru-RU")}
                      {f.targetStems > 0 && (
                        <span className="text-ink-muted">
                          {" "}
                          / {f.targetStems.toLocaleString("ru-RU")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {snapshot.unsplitTargetAmount > 0 && (
            <p className="px-4 py-2 text-xs text-status-warning">
              Ещё {money(snapshot.unsplitTargetAmount)} плана стоит старым числом, без разбивки по
              цветку, — в эту таблицу они не попали. Разнести их можно в разделе «Планы».
            </p>
          )}
        </div>
      )}

      {snapshot.byFarm.length > 0 && (
        <div className="card">
          <h3 className="font-medium mb-1">Продажи по производствам</h3>
          <p className="text-xs text-ink-muted mb-3">
            Rose Farm — розы и эустома, Есентай Агро Хим — хризантема
          </p>
          <div className="space-y-3">
            {snapshot.byFarm.map((f) => (
              <div key={f.farm}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: FARM_COLOR[f.farm] ?? CHART_COLORS.series3 }}
                    />
                    {farmLabel(f.farm)}
                  </span>
                  <span className="tabular-nums">
                    <b>{money(f.amount)}</b>
                    <span className="text-ink-muted">
                      {" "}· {f.stems.toLocaleString("ru-RU")} шт. · {Math.round(f.share)}%
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-plane overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${f.share}%`,
                      background: FARM_COLOR[f.farm] ?? CHART_COLORS.series3,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Продажи по дням" description={`Сумма оформленных заявок, ${snapshot.periodLabel}`}>
          <ResponsiveContainer>
            <BarChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} interval={2} />
              <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={54} tickFormatter={shortMoney} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => `${v} ${periodLabel(snapshot.period).split(" ")[0]}`}
                formatter={(value: number) => [money(value), "Продано"]}
              />
              <Bar dataKey="amount" fill={CHART_COLORS.series1} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Накопительно к плану" description="Факт нарастающим итогом против равномерного плана">
          <ResponsiveContainer>
            <LineChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} interval={2} />
              <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={54} tickFormatter={shortMoney} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [
                  money(value),
                  name === "cumulative" ? "Факт" : "План",
                ]}
              />
              <Legend formatter={(name: string) => (name === "cumulative" ? "Факт" : "План")} wrapperStyle={{ fontSize: 12 }} />
              {hasPlan && (
                <Line
                  type="monotone"
                  dataKey="planCumulative"
                  stroke={CHART_COLORS.axis}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke={CHART_COLORS.series1}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium text-right">Сегодня</th>
              <th className="px-4 py-3 font-medium text-right">За месяц</th>
              <th className="px-4 py-3 font-medium text-right">Заявок</th>
              <th className="px-4 py-3 font-medium text-right">Средний чек</th>
              <th className="px-4 py-3 font-medium text-right">План</th>
              <th className="px-4 py-3 font-medium w-44">Выполнение</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.managers.map((m) => (
              <ManagerRow key={m.managerEmail} row={m} daysShare={daysShare} />
            ))}
            {snapshot.managers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                  За этот месяц продаж пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagerRow({ row, daysShare }: { row: ManagerSalesRow; daysShare: number }) {
  const hasPlan = row.targetAmount > 0;
  const tone = hasPlan ? progressTone(row.progressPercent, daysShare) : "ok";

  return (
    <tr className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-ink-muted">{row.managerEmail}</div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {row.amountToday > 0 ? money(row.amountToday) : <span className="text-ink-muted">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-medium">
        {money(row.amountMonth)}
        {row.amountMonth > 0 && (
          <div className="text-xs font-normal text-ink-muted">
            {FARM_ORDER.filter((f) => (row.byFarm[f] ?? 0) > 0)
              .map((f) => `${farmLabel(f)} ${shortMoney(row.byFarm[f] ?? 0)}`)
              .join(" · ")}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{row.ordersMonth}</td>
      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
        {row.ordersMonth > 0 ? money(row.avgOrderAmount) : "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
        {hasPlan ? money(row.targetAmount) : "—"}
      </td>
      <td className="px-4 py-3">
        {hasPlan ? (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className={clsx("font-medium tabular-nums", TONE_TEXT[tone])}>
                {row.progressPercent.toFixed(0)}%
              </span>
              <span className="text-ink-muted tabular-nums">
                {shortMoney(Math.max(0, row.targetAmount - row.amountMonth))} осталось
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-plane overflow-hidden">
              <div
                className={clsx("h-full rounded-full", TONE_BAR[tone])}
                style={{ width: `${Math.min(100, row.progressPercent)}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-xs text-ink-muted">план не задан</span>
        )}
      </td>
    </tr>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "ok" | "warning" | "critical";
}) {
  return (
    <div className="card !p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div
        className={clsx(
          "text-2xl font-semibold tabular-nums",
          tone === "default" ? "text-ink-primary" : TONE_TEXT[tone]
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
