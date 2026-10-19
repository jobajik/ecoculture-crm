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
import { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";
import KpiTile from "@/components/KpiTile";
import CardTabs from "@/components/CardTabs";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import { FARM_ORDER, FLOWER_TYPE_LABELS_PLURAL, farmLabel } from "@/lib/constants";
import type { ManagerSalesRow, SalesSnapshot } from "@/lib/salesAnalytics";

const FARM_COLOR: Record<string, string> = {
  [FARM_ORDER[0]]: CHART_COLORS.series1,
  [FARM_ORDER[1]]: CHART_COLORS.series2,
};

const REFRESH_MS = 60_000;

type View = "managers" | "flowers" | "farms" | "charts";

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
  const [view, setView] = useState<View>("managers");

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

  const tabs: { key: View; label: string }[] = [
    { key: "managers", label: `Менеджеры (${snapshot.managers.length})` },
    ...(snapshot.byFlower.length > 0 ? [{ key: "flowers" as View, label: "По цветку" }] : []),
    ...(snapshot.byFarm.length > 0 ? [{ key: "farms" as View, label: "По производствам" }] : []),
    { key: "charts", label: "Графики" },
  ];
  const shownView = tabs.some((x) => x.key === view) ? view : "managers";

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="chart"
          label="Продано за месяц"
          value={money(t.amountMonth)}
          hint={`${t.ordersMonth} заявок · ${t.stemsMonth.toLocaleString("ru-RU")} шт.`}
        />
        <KpiTile
          icon="list"
          label="План на месяц"
          value={hasPlan ? money(t.targetAmount) : "не задан"}
          hint={hasPlan ? `осталось ${money(Math.max(0, t.targetAmount - t.amountMonth))}` : "ставит РОП в «Планах»"}
          href={hasPlan ? undefined : "/plans/sales"}
        />
        <KpiTile
          icon="trophy"
          label="Выполнение плана"
          value={<span className={hasPlan ? TONE_TEXT[tone] : undefined}>{hasPlan ? `${t.progressPercent.toFixed(0)}%` : "—"}</span>}
          hint={hasPlan ? `прогноз ${money(t.forecastAmount)}` : undefined}
          tone={!hasPlan || tone === "ok" ? undefined : tone === "good" ? "good" : tone === "warning" ? "warn" : "bad"}
        />
        <KpiTile icon="calendar" label="Продано сегодня" value={money(t.amountToday)} hint={`${t.ordersToday} заявок`} />
      </div>

      {hasPlan && (
        <div className="card !p-4 sm:!p-5 mb-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2.5">
            <span className="font-display text-[15px] font-bold">План месяца</span>
            <span className="text-sm text-ink-secondary tabular-nums">
              <b className="text-ink-primary">{money(t.amountMonth)}</b> из {money(t.targetAmount)}
              {t.requiredPerDay > 0 && <span className="text-ink-muted"> · нужно {money(t.requiredPerDay)}/день</span>}
            </span>
          </div>
          <div className="relative h-3 rounded-full bg-surface-sunk overflow-hidden">
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
            <span>темп на сегодня — {(daysShare * 100).toFixed(0)}%</span>
            <span>{shortMoney(t.targetAmount)}</span>
          </div>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <CardTabs
          tone="sales"
          items={tabs}
          value={shownView}
          onChange={setView}
          right={
            <>
              {loading && <span className="text-ink-muted">обновляю…</span>}
              {error && <span className="text-status-critical">{error}</span>}
              <span className="text-ink-muted tabular-nums hidden sm:inline">
                день {t.daysPassed} из {t.daysInMonth}
              </span>
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
            </>
          }
        />

        {shownView === "managers" && (
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Менеджер</th>
                  <th className={clsx(TH, "text-right")}>Сегодня</th>
                  <th className={clsx(TH, "text-right")}>За месяц</th>
                  <th className={clsx(TH, "text-right")}>Заявок</th>
                  <th className={clsx(TH, "text-right")}>Средний чек</th>
                  <th className={clsx(TH, "text-right")}>План</th>
                  <th className={clsx(TH, "min-w-[170px]")}>Выполнение</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.managers.map((m) => (
                  <ManagerRow key={m.managerEmail} row={m} daysShare={daysShare} />
                ))}
                {snapshot.managers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-ink-muted">
                      За этот месяц продаж пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {shownView === "flowers" && (
          <>
            <div className="table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={TH}>Цветок</th>
                    <th className={clsx(TH, "text-right")}>План</th>
                    <th className={clsx(TH, "text-right")}>Продано</th>
                    <th className={clsx(TH, "text-right")}>Выполнение</th>
                    <th className={clsx(TH, "text-right")}>Стебли, факт / план</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.byFlower.map((f) => {
                    const ft = f.progressPercent === null ? "ok" : progressTone(f.progressPercent, daysShare);
                    return (
                      <tr key={f.flowerType} className={TR}>
                        <td className="px-4 py-3 font-semibold">{FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}</td>
                        <td data-label="План" className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                          {f.targetAmount > 0 ? money(f.targetAmount) : "—"}
                        </td>
                        <td data-label="Продано" className="px-4 py-3 text-right tabular-nums font-semibold">
                          {money(f.amount)}
                        </td>
                        <td data-label="Выполнение" className={clsx("px-4 py-3 text-right tabular-nums font-semibold", TONE_TEXT[ft])}>
                          {f.progressPercent === null ? "плана нет" : `${Math.round(f.progressPercent)}%`}
                        </td>
                        <td data-label="Стебли" className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                          {f.stems.toLocaleString("ru-RU")}
                          {f.targetStems > 0 && <span className="text-ink-muted"> / {f.targetStems.toLocaleString("ru-RU")}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {snapshot.unsplitTargetAmount > 0 && (
              <p className="px-4 sm:px-5 py-3 text-xs text-[#8a5a00] border-t border-line-hairline">
                Ещё {money(snapshot.unsplitTargetAmount)} плана без разбивки по цветку — не в таблице.
              </p>
            )}
          </>
        )}

        {shownView === "farms" && (
          <div className="p-4 sm:p-5 grid gap-4 md:grid-cols-2">
            {snapshot.byFarm.map((f) => (
              <div key={f.farm} className="rounded-2xl border border-line-hairline p-4">
                <div className="flex items-center gap-2 text-sm text-ink-secondary">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: FARM_COLOR[f.farm] ?? CHART_COLORS.series3 }} />
                  {farmLabel(f.farm)}
                  <span className="ml-auto tabular-nums text-ink-muted">{Math.round(f.share)}%</span>
                </div>
                <div className="font-display text-[26px] font-extrabold tabular-nums leading-none mt-2">{money(f.amount)}</div>
                <div className="text-xs text-ink-muted mt-1.5 tabular-nums">{f.stems.toLocaleString("ru-RU")} шт.</div>
                <div className="h-2 rounded-full bg-surface-sunk overflow-hidden mt-3">
                  <div className="h-full rounded-full" style={{ width: `${f.share}%`, background: FARM_COLOR[f.farm] ?? CHART_COLORS.series3 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {shownView === "charts" && (
          <div className="p-4 sm:p-5 grid lg:grid-cols-2 gap-5">
            <div>
              <div className="text-sm font-semibold mb-0.5">Продажи по дням</div>
              <div className="text-xs text-ink-muted mb-3">Сумма оформленных заявок, {snapshot.periodLabel}</div>
              <div style={{ width: "100%", height: 260 }}>
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
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold mb-0.5">Накопительно к плану</div>
              <div className="text-xs text-ink-muted mb-3">Факт нарастающим итогом против равномерного плана</div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} interval={2} />
                    <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={54} tickFormatter={shortMoney} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name: string) => [money(value), name === "cumulative" ? "Факт" : "План"]}
                    />
                    <Legend formatter={(name: string) => (name === "cumulative" ? "Факт" : "План")} wrapperStyle={{ fontSize: 12 }} />
                    {hasPlan && (
                      <Line type="monotone" dataKey="planCumulative" stroke={CHART_COLORS.axis} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    )}
                    <Line type="monotone" dataKey="cumulative" stroke={CHART_COLORS.series1} strokeWidth={2} dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManagerRow({ row, daysShare }: { row: ManagerSalesRow; daysShare: number }) {
  const hasPlan = row.targetAmount > 0;
  const tone = hasPlan ? progressTone(row.progressPercent, daysShare) : "ok";

  return (
    <tr className={TR}>
      <td className="px-4 py-3">
        <div className="font-semibold whitespace-nowrap">{row.name}</div>
        <div className="text-xs text-ink-muted">{row.managerEmail}</div>
      </td>
      <td data-label="Сегодня" className="px-4 py-3 text-right tabular-nums">
        {row.amountToday > 0 ? money(row.amountToday) : <span className="text-ink-muted">—</span>}
      </td>
      <td data-label="За месяц" className="px-4 py-3 text-right tabular-nums font-display font-extrabold whitespace-nowrap">
        {money(row.amountMonth)}
        {row.amountMonth > 0 && (
          <div className="text-xs font-normal font-sans text-ink-muted">
            {FARM_ORDER.filter((f) => (row.byFarm[f] ?? 0) > 0)
              .map((f) => `${farmLabel(f)} ${shortMoney(row.byFarm[f] ?? 0)}`)
              .join(" · ")}
          </div>
        )}
      </td>
      <td data-label="Заявок" className="px-4 py-3 text-right tabular-nums text-ink-secondary">{row.ordersMonth}</td>
      <td data-label="Средний чек" className="px-4 py-3 text-right tabular-nums text-ink-secondary whitespace-nowrap">
        {row.ordersMonth > 0 ? money(row.avgOrderAmount) : "—"}
      </td>
      <td data-label="План" className="px-4 py-3 text-right tabular-nums text-ink-secondary whitespace-nowrap">
        {hasPlan ? money(row.targetAmount) : "—"}
      </td>
      <td data-label="Выполнение" className="px-4 py-3">
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
            <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden">
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
