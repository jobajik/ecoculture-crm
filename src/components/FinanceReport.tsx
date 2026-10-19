"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard, { CHART_COLORS } from "@/components/charts/ChartCard";
import type { FinanceSnapshot, FinancePeriod } from "@/lib/finance";
import PeriodStepper from "@/components/PeriodStepper";
import Pager, { pageSlice } from "@/components/Pager";

// Оплачено / не оплачено — две части одной суммы, поэтому столбик составной.
// Цвета взяты из проверенной палитры приложения (series3/series4): при протанопии
// ΔE 9.1, при обычном зрении 22.9 — пара различима. Контраст к фону ниже 3:1,
// поэтому обязательны подписи значений и таблица под графиком — они ниже есть.
const PAID = CHART_COLORS.series3;
const UNPAID = CHART_COLORS.series4;

const PERIODS: { key: FinancePeriod; label: string }[] = [
  { key: "day", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
];

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

function shortMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} тыс.`;
  return String(Math.round(value));
}

export default function FinanceReport({
  snapshot,
  farms,
  today,
}: {
  snapshot: FinanceSnapshot;
  farms: { farm: string; amount: number; label: string }[];
  /** Сегодня по Алматы — для листания периода. */
  today: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const t = snapshot.totals;
  const [view, setView] = useState<"managers" | "days">("managers");
  const [page, setPage] = useState(0);

  const data = snapshot.daily.map((d) => ({ ...d, total: d.paid + d.unpaid }));
  // Подписываем итог дня только там, где он есть — числа над каждым столбиком
  // без разбора превращаются в шум.
  const maxTotal = Math.max(0, ...data.map((d) => d.total));

  function switchPeriod(next: FinancePeriod) {
    const q = new URLSearchParams(params.toString());
    q.set("period", next);
    router.push(`/finance/report?${q.toString()}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => switchPeriod(p.key)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                snapshot.period === p.key
                  ? "bg-accent text-white border-accent"
                  : "border-line-hairline text-ink-secondary hover:bg-surface-plane"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <PeriodStepper
          basePath="/finance/report"
          period={snapshot.period}
          from={snapshot.from}
          to={snapshot.to}
          label={snapshot.periodLabel}
          today={today}
        />
        <a
          href={`/api/finance/report?period=${snapshot.period}&date=${snapshot.from}`}
          className="btn-primary !py-1.5"
          download
        >
          ↓ Выгрузить в Excel
        </a>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile label="Оформлено" value={money(t.amount)} sub={`${t.orders} заявок`} />
        <Tile label="Оплачено" value={money(t.paidAmount)} sub={`${t.paidOrders} заявок`} bar={t.collectPercent} />
        <Tile label="Ждём оплату" value={money(t.unpaidAmount)} sub={`${t.orders - t.paidOrders} заявок`} />
        <Tile label="Средний чек" value={t.orders > 0 ? money(t.avgOrder) : "—"} sub={`собираемость ${t.collectPercent.toFixed(0)}%`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0">
        <ChartCard
          title="Выручка по дням"
          description="Сумма заявок за день и оплаченная часть"
          height={240}
        >
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                width={58}
                tickFormatter={shortMoney}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: CHART_COLORS.grid, opacity: 0.35 }}
                contentStyle={{
                  background: "#ffffff",
                  border: `1px solid ${CHART_COLORS.grid}`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#0b0b0b",
                }}
                formatter={(value: number, name: string) => [
                  money(value),
                  name === "paid" ? "Оплачено" : "Не оплачено",
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                formatter={(name: string) => (
                  <span style={{ color: CHART_COLORS.textSecondary }}>
                    {name === "paid" ? "Оплачено" : "Не оплачено"}
                  </span>
                )}
              />
              {/* Зазор 2px между сегментами — обводка цветом подложки */}
              <Bar
                dataKey="paid"
                stackId="revenue"
                fill={PAID}
                stroke={CHART_COLORS.surface}
                strokeWidth={2}
                maxBarSize={30}
              />
              <Bar
                dataKey="unpaid"
                stackId="revenue"
                fill={UNPAID}
                stroke={CHART_COLORS.surface}
                strokeWidth={2}
                maxBarSize={30}
                radius={[4, 4, 0, 0]}
                label={{
                  position: "top",
                  fontSize: 10,
                  fill: CHART_COLORS.textSecondary,
                  formatter: (v: number, _e?: unknown, index?: number) => {
                    const point = typeof index === "number" ? data[index] : undefined;
                    if (!point || point.total === 0) return "";
                    // Подписываем только заметные дни, чтобы не засорять график
                    return point.total >= maxTotal * 0.25 ? shortMoney(point.total) : "";
                  },
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        </div>

        <div className="card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line-hairline">
            <h3 className="font-semibold text-sm">Чем платили</h3>
            <p className="text-xs text-ink-muted">Только по оплаченным заявкам периода</p>
          </div>
          <div className="px-4 py-3 space-y-2">
            {snapshot.byMethod.length === 0 ? (
              <p className="text-sm text-ink-muted">Оплат пока нет.</p>
            ) : (
              snapshot.byMethod.map((m) => (
                <div key={m.method} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{m.method}</span>
                  <span className="tabular-nums">
                    <b>{money(m.amount)}</b>
                    <span className="text-ink-muted"> · {m.orders}</span>
                  </span>
                </div>
              ))
            )}
          </div>
          {farms.length > 0 && (
            <>
              <div className="px-4 py-3 border-y border-line-hairline">
                <h3 className="font-semibold text-sm">По производствам</h3>
              </div>
              <div className="px-4 py-3 space-y-2">
                {farms.map((f) => (
                  <div key={f.farm} className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{f.label}</span>
                    <span className="tabular-nums font-medium">{money(f.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex gap-1 px-2 border-b border-line-hairline overflow-x-auto scroll-x-hidden">
          {(
            [
              ["managers", `По менеджерам (${snapshot.byManager.length})`],
              ["days", "По дням"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setView(key);
                setPage(0);
              }}
              className={clsx(
                "px-4 py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
                view === key
                  ? "border-section-money text-ink-primary font-semibold"
                  : "border-transparent text-ink-secondary hover:text-ink-primary"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "managers" ? (
          <>
            <div className="table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline">
                    <th className="px-4 py-2.5 font-medium">Менеджер</th>
                    <th className="px-4 py-2.5 font-medium text-right">Оформлено</th>
                    <th className="px-4 py-2.5 font-medium text-right">Оплачено</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice(snapshot.byManager, page).map((m) => (
                    <tr key={m.managerName} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2.5">{m.managerName}</td>
                      <td data-label="Оформлено" className="px-4 py-2.5 text-right tabular-nums">{money(m.amount)}</td>
                      <td data-label="Оплачено" className="px-4 py-2.5 text-right tabular-nums">{money(m.paidAmount)}</td>
                    </tr>
                  ))}
                  {snapshot.byManager.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-ink-muted">
                        За период заявок нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager total={snapshot.byManager.length} page={page} onPage={setPage} what="менеджеров" />
          </>
        ) : (
          <>
            {/* Таблица данных графика — обязательное сопровождение, когда контраст
                заливки к фону ниже 3:1 (см. dataviz: relief required). */}
            <div className="table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline">
                    <th className="px-4 py-2.5 font-medium">День</th>
                    <th className="px-4 py-2.5 font-medium text-right">Оплачено</th>
                    <th className="px-4 py-2.5 font-medium text-right">Не оплачено</th>
                    <th className="px-4 py-2.5 font-medium text-right">Всего</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice(data, page).map((d) => (
                    <tr key={d.date} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2.5">{d.label}</td>
                      <td data-label="Оплачено" className="px-4 py-2.5 text-right tabular-nums">{money(d.paid)}</td>
                      <td data-label="Не оплачено" className="px-4 py-2.5 text-right tabular-nums">{money(d.unpaid)}</td>
                      <td data-label="Всего" className="px-4 py-2.5 text-right tabular-nums font-medium">{money(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager total={data.length} page={page} onPage={setPage} what="дней" />
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, bar }: { label: string; value: string; sub?: string; bar?: number }) {
  return (
    <div className="card !p-4 sm:!p-5">
      <div className="text-xs text-ink-muted mb-1.5">{label}</div>
      <div className="font-display text-[22px] sm:text-[26px] leading-none font-extrabold tabular-nums">{value}</div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-surface-sunk overflow-hidden">
          <div className="h-full rounded-full bg-section-money" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
      {sub && <div className="text-xs text-ink-secondary mt-2">{sub}</div>}
    </div>
  );
}
