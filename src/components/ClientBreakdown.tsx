"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { BreakdownRow } from "@/lib/clientAnalytics";
import Change from "./Change";
import Pager, { pageSlice } from "./Pager";

type View = "manager" | "city" | "type" | "flower";

const VIEWS: { key: View; label: string; column: string }[] = [
  { key: "manager", label: "Менеджеры", column: "Менеджер" },
  { key: "city", label: "Города", column: "Город" },
  { key: "type", label: "Тип точки", column: "Тип точки" },
  { key: "flower", label: "Цветы", column: "Цветок" },
];

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

/**
 * Разрезы месяца одной таблицей с переключателем — а не четыре таблицы
 * подряд: смотрят их по одному, и полотно из четырёх таблиц читается хуже.
 */
export default function ClientBreakdown({
  rows,
  prevLabel,
  extraTabs = [],
}: {
  rows: Record<View, BreakdownRow[]>;
  /** «август» — с чем сравниваем. */
  prevLabel: string;
  /** Ещё вкладки в той же карточке (крупнейшие клиенты, «давно не заказывали») — их рисует страница. */
  extraTabs?: { key: string; label: string; count?: number; content: ReactNode }[];
}) {
  const [tab, setTab] = useState<string>("manager");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [tab]);
  const extra = extraTabs.find((t) => t.key === tab);
  const view: View = extra ? "manager" : (tab as View);
  const list = rows[view];
  const flower = view === "flower";
  const maxShare = Math.max(1, ...list.map((r) => r.share));
  const hasPrev = list.some((r) => r.prevRevenue > 0);
  const tabs = [...VIEWS.map((v) => ({ key: v.key as string, label: v.label, count: undefined as number | undefined })), ...extraTabs];

  return (
    <section className="card !p-0 overflow-hidden min-w-0">
      <div className="flex gap-x-5 overflow-x-auto scroll-x-hidden border-b border-line-hairline px-4" role="tablist">
        {tabs.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={tab === v.key}
            onClick={() => setTab(v.key)}
            className={clsx(
              "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
              tab === v.key ? "border-section-client text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {v.label}
            {v.count !== undefined && <span className="ml-1.5 text-ink-muted font-normal tabular-nums">{v.count}</span>}
          </button>
        ))}
      </div>

      {extra ? (
        extra.content
      ) : (
      <>
      <div className="table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">{VIEWS.find((v) => v.key === view)!.column}</th>
              <th className="px-3 py-2.5 font-medium text-right">{flower ? "Клиентов" : "Покупали"}</th>
              {!flower && <th className="px-3 py-2.5 font-medium text-right">Новых</th>}
              <th className="px-3 py-2.5 font-medium text-right">Выручка</th>
              {hasPrev && <th className="px-3 py-2.5 font-medium text-right">к {prevLabel}</th>}
              <th className="px-3 py-2.5 font-medium w-36">Доля</th>
              {flower ? (
                <>
                  <th className="px-3 py-2.5 font-medium text-right">Стеблей</th>
                  <th className="px-3 py-2.5 font-medium text-right">Цена стебля</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2.5 font-medium text-right">Ср. чек</th>
                  <th className="px-3 py-2.5 font-medium text-right">Получено</th>
                  <th className="px-4 py-2.5 font-medium text-right">Долг сейчас</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {pageSlice(list, page).map((r) => (
              <tr key={r.key} className="border-b border-line-hairline/70 last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.label}</td>
                <td data-label={flower ? "Клиентов" : "Покупали"} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {r.buyers > 0 ? nf(r.buyers) : "—"}
                  {!flower && r.baseClients > 0 && <span className="text-ink-muted"> из {nf(r.baseClients)}</span>}
                </td>
                {!flower && (
                  <td data-label="Новых" className="px-3 py-2.5 text-right tabular-nums">
                    {r.newBuyers > 0 ? `+${r.newBuyers}` : ""}
                  </td>
                )}
                <td data-label="Выручка" className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                  {r.revenue > 0 ? `${nf(r.revenue)} ₸` : "—"}
                </td>
                {hasPrev && (
                  <td data-label={`к ${prevLabel}`} className="px-3 py-2.5 text-right tabular-nums">
                    <Change now={r.revenue} before={r.prevRevenue} />
                  </td>
                )}
                <td data-label="Доля" className="px-3 py-2.5">
                  {r.share > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-[48px] h-1.5 rounded-full bg-surface-sunk">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(r.share / maxShare) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-ink-secondary">{Math.round(r.share)} %</span>
                    </div>
                  )}
                </td>
                {flower ? (
                  <>
                    <td data-label="Стеблей" className="px-3 py-2.5 text-right tabular-nums">{r.stems > 0 ? nf(r.stems) : ""}</td>
                    <td data-label="Цена стебля" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.stems > 0 ? `${nf(r.revenue / r.stems)} ₸` : ""}
                    </td>
                  </>
                ) : (
                  <>
                    <td data-label="Ср. чек" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.orders > 0 ? `${nf(r.avgCheck)} ₸` : ""}
                    </td>
                    <td
                      data-label="Получено"
                      className={clsx(
                        "px-3 py-2.5 text-right tabular-nums",
                        r.paidPercent !== null && r.paidPercent < 50 && "text-[#8a5a00]"
                      )}
                    >
                      {r.paidPercent !== null ? `${Math.round(r.paidPercent)} %` : ""}
                    </td>
                    <td data-label="Долг сейчас" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.debt > 0 ? `${nf(r.debt)} ₸` : ""}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-ink-muted">
                  За месяц продаж нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={list.length} page={page} onPage={setPage} what="строк" />
      </>
      )}
    </section>
  );
}
