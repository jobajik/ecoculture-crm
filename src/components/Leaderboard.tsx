"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { LeaderboardSnapshot } from "@/lib/leaderboard";
import type { FinancePeriod } from "@/lib/finance";

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
}: {
  snapshot: LeaderboardSnapshot;
  currentEmail: string;
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
          <span className="ml-3 self-center text-sm text-ink-secondary">{snapshot.periodLabel}</span>
        </div>
        <div className="text-sm text-ink-muted">
          Бонус: роза и эустома <b className="text-ink-secondary">1,5%</b>, хризантема{" "}
          <b className="text-ink-secondary">2%</b> — с оплаченных заявок
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

      {snapshot.rows.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-2xl mb-2">🏁</div>
          <p className="font-medium">За этот период продаж пока нет</p>
          <p className="text-sm text-ink-secondary mt-1">
            Как только менеджеры оформят заявки, здесь появится рейтинг.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshot.rows.map((row) => {
            const isMe = row.managerEmail === currentEmail;
            return (
              <div
                key={row.managerEmail}
                className={clsx(
                  "card",
                  isMe && "border-accent/50 bg-accent-soft/40",
                  row.rank === 1 && !isMe && "border-status-good/40"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-xl w-8 text-center shrink-0 tabular-nums">
                      {MEDALS[row.rank - 1] ?? row.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {row.name}
                        {isMe && <span className="text-accent text-sm font-normal"> · вы</span>}
                      </div>
                      <div className="text-xs text-ink-muted">
                        {row.paidOrders} из {row.orders} заявок оплачено ·{" "}
                        {row.paidStems.toLocaleString("ru-RU")} шт.
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold tabular-nums">{money(row.paidAmount)}</div>
                    <div className="text-xs text-status-good font-medium tabular-nums">
                      бонус {money(row.bonus)}
                    </div>
                  </div>
                </div>

                {/* Полоса результата — сразу видно разрыв между менеджерами */}
                <div className="mt-3 h-2 rounded-full bg-surface-plane overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(row.paidAmount / max) * 100}%` }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {Object.entries(row.paidByFlowerType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, amount]) => (
                      <span key={type} className="text-ink-secondary">
                        {FLOWER_TYPE_LABELS[type] ?? type}: <b>{money(amount)}</b>
                        <span className="text-ink-muted">
                          {" "}
                          → {money(row.bonusByFlowerType[type] ?? 0)}
                        </span>
                      </span>
                    ))}
                  {row.pendingAmount > 0 && (
                    <span className="text-ink-muted">
                      не оплачено {money(row.pendingAmount)} (бонус {money(row.pendingBonus)} ждёт)
                    </span>
                  )}
                </div>

                {snapshot.hasPlans && row.targetAmount > 0 && (
                  <div className="mt-3 pt-3 border-t border-line-hairline">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-ink-secondary">
                        План {money(row.targetAmount)}
                      </span>
                      <span
                        className={clsx(
                          "font-medium tabular-nums",
                          row.progressPercent >= 100 ? "text-status-good" : "text-ink-secondary"
                        )}
                      >
                        {row.progressPercent.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-plane overflow-hidden">
                      <div
                        className={clsx(
                          "h-full rounded-full",
                          row.progressPercent >= 100 ? "bg-status-good" : "bg-accent"
                        )}
                        style={{ width: `${Math.min(100, row.progressPercent)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-ink-muted">
        Бонус начисляется только с оплаченных заявок. Планы задаются на вкладке <b>Plans</b> в
        Google-таблице и показываются на месячном периоде.
      </p>
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
