"use client";

import { useState } from "react";
import clsx from "clsx";
import type { FinanceBreakdownRow } from "@/lib/financeAnalytics";
import Change from "./Change";

type View = "manager" | "company" | "method" | "terms";

const VIEWS: { key: View; label: string; column: string }[] = [
  { key: "manager", label: "Менеджеры", column: "Менеджер" },
  { key: "company", label: "Компании", column: "Компания" },
  { key: "method", label: "Способ оплаты", column: "Способ" },
  { key: "terms", label: "Условия клиента", column: "Условия" },
];

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;

/**
 * Разрезы денег месяца одной таблицей с переключателем — как в «Клиенты →
 * Аналитика». У способа оплаты счёта нет (способ есть только у денег), поэтому
 * там колонки поступлений, а не выставленного.
 */
export default function FinanceBreakdown({
  rows,
  prevLabel,
}: {
  rows: Record<View, FinanceBreakdownRow[]>;
  prevLabel: string;
}) {
  const [view, setView] = useState<View>("manager");
  const list = rows[view];
  const cash = view === "method";
  const cashTotal = list.reduce((s, r) => s + r.cashIn, 0);
  const shareOf = (r: FinanceBreakdownRow) => (cash ? (cashTotal > 0 ? (r.cashIn / cashTotal) * 100 : 0) : r.share);
  const maxShare = Math.max(1, ...list.map(shareOf));
  const hasPrev = list.some((r) => (cash ? r.prevCashIn : r.prevBilled) > 0);

  return (
    <section className="card !p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="font-semibold">Разрезы месяца</h2>
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line-hairline bg-surface-plane p-1" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
                view === v.key ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-scroll table-cards border-t border-line-hairline">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">{VIEWS.find((v) => v.key === view)!.column}</th>
              {cash ? (
                <>
                  <th className="px-3 py-2.5 font-medium text-right">Поступлений</th>
                  <th className="px-3 py-2.5 font-medium text-right">Поступило</th>
                  {hasPrev && <th className="px-3 py-2.5 font-medium text-right">к {prevLabel}</th>}
                  <th className="px-4 py-2.5 font-medium w-40">Доля</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2.5 font-medium text-right">Заявок</th>
                  <th className="px-3 py-2.5 font-medium text-right">Выставлено</th>
                  {hasPrev && <th className="px-3 py-2.5 font-medium text-right">к {prevLabel}</th>}
                  <th className="px-3 py-2.5 font-medium w-36">Доля</th>
                  <th className="px-3 py-2.5 font-medium text-right">Собрано</th>
                  <th className="px-3 py-2.5 font-medium text-right">Поступило</th>
                  <th className="px-3 py-2.5 font-medium text-right">Долг сейчас</th>
                  <th className="px-3 py-2.5 font-medium text-right">просрочено</th>
                  <th className="px-4 py-2.5 font-medium text-right">Срок оплаты</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const share = shareOf(r);
              return (
                <tr key={r.key} className="border-b border-line-hairline/70 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{r.label}</td>
                  {cash ? (
                    <>
                      <td data-label="Поступлений" className="px-3 py-2.5 text-right tabular-nums">{r.orders > 0 ? nf(r.orders) : ""}</td>
                      <td data-label="Поступило" className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                        {r.cashIn ? money(r.cashIn) : "—"}
                      </td>
                      {hasPrev && (
                        <td data-label={`к ${prevLabel}`} className="px-3 py-2.5 text-right tabular-nums">
                          <Change now={r.cashIn} before={r.prevCashIn} />
                        </td>
                      )}
                    </>
                  ) : (
                    <>
                      <td data-label="Заявок" className="px-3 py-2.5 text-right tabular-nums">{r.orders > 0 ? nf(r.orders) : ""}</td>
                      <td data-label="Выставлено" className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                        {r.billed > 0 ? money(r.billed) : "—"}
                      </td>
                      {hasPrev && (
                        <td data-label={`к ${prevLabel}`} className="px-3 py-2.5 text-right tabular-nums">
                          <Change now={r.billed} before={r.prevBilled} />
                        </td>
                      )}
                    </>
                  )}
                  <td data-label="Доля" className={clsx("py-2.5", cash ? "px-4" : "px-3")}>
                    {share > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-[48px] h-1.5 rounded-full bg-surface-sunk">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${(share / maxShare) * 100}%` }} />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums text-ink-secondary">{Math.round(share)} %</span>
                      </div>
                    )}
                  </td>
                  {!cash && (
                    <>
                      <td
                        data-label="Собрано"
                        className={clsx(
                          "px-3 py-2.5 text-right tabular-nums",
                          r.collectedPercent !== null && r.collectedPercent < 50 && "text-[#8a5a00]"
                        )}
                      >
                        {r.collectedPercent !== null ? `${Math.round(r.collectedPercent)} %` : ""}
                      </td>
                      <td data-label="Поступило" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {r.cashIn ? money(r.cashIn) : ""}
                      </td>
                      <td data-label="Долг сейчас" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {r.debt > 0 ? money(r.debt) : ""}
                      </td>
                      <td data-label="просрочено" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-status-critical">
                        {r.overdue > 0 ? money(r.overdue) : ""}
                      </td>
                      <td data-label="Срок оплаты" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-ink-secondary">
                        {r.daysToPay !== null ? `${nf(r.daysToPay)} дн.` : ""}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-ink-muted">
                  {cash ? "За месяц денег не поступало." : "За месяц счетов нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
