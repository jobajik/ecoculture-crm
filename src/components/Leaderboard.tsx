"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { LeaderboardSnapshot } from "@/lib/leaderboard";
import type { FinancePeriod } from "@/lib/finance";
import PeriodStepper from "@/components/PeriodStepper";
import Chips from "@/components/Chips";

const PERIODS: { key: FinancePeriod; label: string }[] = [
  { key: "day", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
];

const MEDALS = ["🥇", "🥈", "🥉"];

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

export default function Leaderboard({
  snapshot,
  currentEmail,
  today,
}: {
  snapshot: LeaderboardSnapshot;
  currentEmail: string;
  /** Сегодня по Алматы — для листания периода. */
  today: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const t = snapshot.totals;
  const max = Math.max(1, ...snapshot.rows.map((r) => r.paidAmount));

  function switchPeriod(next: FinancePeriod) {
    const q = new URLSearchParams(params.toString());
    q.set("period", next);
    router.push(`/sales?${q.toString()}`);
  }

  const tone = (v: number) => (v >= 100 ? "text-status-good" : "text-ink-secondary");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Chips
          value={snapshot.period}
          onChange={(v) => switchPeriod(v as FinancePeriod)}
          items={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
        />
        <PeriodStepper
          basePath="/sales"
          period={snapshot.period}
          from={snapshot.from}
          to={snapshot.to}
          label={snapshot.periodLabel}
          today={today}
        />
        <span className="text-sm text-ink-muted lg:ml-auto">
          Бонус с оплаченных: роза и эустома <b className="text-ink-secondary">1,5 %</b>, хризантема{" "}
          <b className="text-ink-secondary">2 %</b>
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile label="Оплачено всего" value={money(t.paidAmount)} sub={`${t.orders} заявок`} />
        <Tile label="Ждём оплату" value={money(t.pendingAmount)} sub="бонус пока не начислен" />
        <Tile label="Бонусный фонд" value={money(t.bonus)} sub="начислено за период" />
        <Tile
          label={snapshot.hasPlans ? "План месяца" : "Средний чек"}
          value={
            snapshot.hasPlans
              ? money(t.targetAmount)
              : t.orders > 0
              ? money(t.totalAmount / t.orders)
              : "—"
          }
          sub={
            snapshot.hasPlans
              ? `выполнено ${t.targetAmount > 0 ? Math.round((t.paidAmount / t.targetAmount) * 100) : 0}%`
              : "по всем заявкам"
          }
        />
      </div>

      {/* Рейтинг одной таблицей (новый вид, 19.10.2026): строка на менеджера вместо высоких карточек друг под
          другом — весь отдел виден на одном экране. */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-line-hairline">
          <h2 className="font-display text-[15px] font-bold">Рейтинг менеджеров</h2>
          <span className="text-sm text-ink-muted">· по оплаченным заявкам</span>
          {!snapshot.hasPlans && <span className="ml-auto text-xs text-ink-muted">план виден на периоде «месяц»</span>}
        </div>
        {snapshot.rows.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-2xl mb-2">🏁</div>
            <p className="font-medium">За этот период продаж нет</p>
          </div>
        ) : (
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                  <th className="px-4 py-2.5 font-medium w-12">#</th>
                  <th className="px-4 py-2.5 font-medium">Менеджер</th>
                  <th className="px-4 py-2.5 font-medium min-w-[220px]">Результат</th>
                  <th className="px-4 py-2.5 font-medium text-right">Оплачено</th>
                  <th className="px-4 py-2.5 font-medium text-right">Бонус</th>
                  <th className="px-4 py-2.5 font-medium text-right">Ждём оплату</th>
                  {snapshot.hasPlans && <th className="px-4 py-2.5 font-medium min-w-[150px]">План</th>}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.map((row) => {
                  const isMe = row.managerEmail === currentEmail;
                  return (
                    <tr
                      key={row.managerEmail}
                      className={clsx("border-b border-line-hairline last:border-0 align-top", isMe ? "bg-accent-soft/50" : "hover:bg-surface-plane")}
                    >
                      <td className="px-4 py-3 text-lg tabular-nums">{MEDALS[row.rank - 1] ?? row.rank}</td>
                      <td data-label="Менеджер" className="px-4 py-3">
                        <div className="font-semibold whitespace-nowrap">
                          {row.name}
                          {isMe && <span className="text-accent text-xs font-normal"> · вы</span>}
                        </div>
                        <div className="text-xs text-ink-muted whitespace-nowrap">
                          {row.paidOrders} из {row.orders} заявок · {row.paidStems.toLocaleString("ru-RU")} шт.
                        </div>
                      </td>
                      <td data-label="Результат" className="px-4 py-3">
                        <div className="h-2 rounded-full bg-surface-sunk overflow-hidden mt-1.5">
                          <div className="h-full rounded-full bg-section-sales" style={{ width: `${(row.paidAmount / max) * 100}%` }} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-secondary">
                          {Object.entries(row.paidByFlowerType)
                            .sort((a, b) => b[1] - a[1])
                            .map(([type, amount]) => (
                              <span key={type} className="whitespace-nowrap">
                                {FLOWER_TYPE_LABELS[type] ?? type} <b className="text-ink-primary">{money(amount)}</b>
                              </span>
                            ))}
                        </div>
                      </td>
                      <td data-label="Оплачено" className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="font-display font-extrabold tabular-nums">{money(row.paidAmount)}</div>
                        {row.pointAmount > 0 && (
                          <div className="text-xs text-ink-muted tabular-nums">точка {money(row.pointAmount)}</div>
                        )}
                      </td>
                      <td data-label="Бонус" className="px-4 py-3 text-right whitespace-nowrap font-semibold text-status-good tabular-nums">
                        {money(row.bonus)}
                      </td>
                      <td data-label="Ждём оплату" className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-ink-secondary">
                        {row.pendingAmount > 0 ? (
                          <>
                            {money(row.pendingAmount)}
                            <div className="text-xs text-ink-muted">бонус {money(row.pendingBonus)} ждёт</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      {snapshot.hasPlans && (
                        <td data-label="План" className="px-4 py-3">
                          {row.targetAmount > 0 ? (
                            <>
                              <div className="flex justify-between gap-2 text-xs mb-1 whitespace-nowrap">
                                <span className="text-ink-secondary">{money(row.targetAmount)}</span>
                                <span className={clsx("font-semibold tabular-nums", tone(row.progressPercent))}>
                                  {row.progressPercent.toFixed(0)}%
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden">
                                <div
                                  className={clsx("h-full rounded-full", row.progressPercent >= 100 ? "bg-status-good" : "bg-accent")}
                                  style={{ width: `${Math.min(100, row.progressPercent)}%` }}
                                />
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-ink-muted">без плана</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card !p-4 sm:!p-5">
      <div className="text-xs text-ink-muted mb-1.5">{label}</div>
      <div className="font-display text-[22px] sm:text-[26px] leading-none font-extrabold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-secondary mt-2">{sub}</div>}
    </div>
  );
}
