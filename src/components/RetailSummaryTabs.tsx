"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import Pager, { pageSlice } from "./Pager";

export interface RetailSummaryShop {
  key: string;
  name: string;
  city: string;
  orders: number;
  stems: number;
  amount: number;
  share: string;
}
export interface RetailSummaryVariety {
  key: string;
  flower: string;
  variety: string;
  grade: string;
  stems: number;
  amount: number;
}
export interface RetailSummaryTerritory {
  key: string;
  label: string;
  orders: number;
  stems: number;
  amount: number;
}

type View = "shops" | "varieties" | "territories";
const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const nf = (v: number) => v.toLocaleString("ru-RU");
const th = "px-4 py-2.5 font-medium";
const td = "px-4 py-2.5";

/**
 * Сводка розницы одной карточкой (новый вид, 19.10.2026): «По магазинам», «Что возим» и «По направлениям» —
 * вкладками со страницами, а не тремя таблицами друг под другом.
 */
export default function RetailSummaryTabs({
  shops,
  varieties,
  territories,
}: {
  shops: RetailSummaryShop[];
  varieties: RetailSummaryVariety[];
  territories: RetailSummaryTerritory[];
}) {
  const [view, setView] = useState<View>("shops");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [view]);

  const tabs: { key: View; label: string; n: number }[] = [
    { key: "shops", label: "По магазинам", n: shops.length },
    { key: "varieties", label: "Что возим", n: varieties.length },
    ...(territories.length > 1 ? [{ key: "territories" as const, label: "По направлениям", n: territories.length }] : []),
  ];
  const total = view === "shops" ? shops.length : view === "varieties" ? varieties.length : territories.length;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className={clsx(
              "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
              view === t.key ? "border-section-retail text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {t.label} <span className="tabular-nums text-ink-muted">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          {view === "shops" && (
            <>
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                  <th className={th}>Магазин</th>
                  <th className={th}>Город</th>
                  <th className={`${th} text-right`}>Заявок</th>
                  <th className={`${th} text-right`}>Стеблей</th>
                  <th className={`${th} text-right`}>Сумма</th>
                  <th className={`${th} text-right`}>Доля</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice(shops, page).map((r) => (
                  <tr key={r.key} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td data-label="Магазин" className={`${td} font-medium`}>
                      {r.name}
                    </td>
                    <td data-label="Город" className={`${td} text-ink-secondary`}>
                      {r.city || "—"}
                    </td>
                    <td data-label="Заявок" className={`${td} text-right tabular-nums`}>
                      {r.orders}
                    </td>
                    <td data-label="Стеблей" className={`${td} text-right tabular-nums`}>
                      {nf(r.stems)}
                    </td>
                    <td data-label="Сумма" className={`${td} text-right tabular-nums`}>
                      {money(r.amount)}
                    </td>
                    <td data-label="Доля" className={`${td} text-right tabular-nums text-ink-secondary`}>
                      {r.share}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {view === "varieties" && (
            <>
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                  <th className={th}>Цветок</th>
                  <th className={th}>Сорт</th>
                  <th className={th}>Длина / категория</th>
                  <th className={`${th} text-right`}>Стеблей</th>
                  <th className={`${th} text-right`}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice(varieties, page).map((r) => (
                  <tr key={r.key} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td data-label="Цветок" className={td}>
                      {r.flower}
                    </td>
                    <td data-label="Сорт" className={`${td} font-medium`}>
                      {r.variety}
                    </td>
                    <td data-label="Длина / категория" className={`${td} text-ink-secondary`}>
                      {r.grade}
                    </td>
                    <td data-label="Стеблей" className={`${td} text-right tabular-nums`}>
                      {nf(r.stems)}
                    </td>
                    <td data-label="Сумма" className={`${td} text-right tabular-nums`}>
                      {money(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {view === "territories" && (
            <>
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                  <th className={th}>Направление</th>
                  <th className={`${th} text-right`}>Заявок</th>
                  <th className={`${th} text-right`}>Стеблей</th>
                  <th className={`${th} text-right`}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice(territories, page).map((r) => (
                  <tr key={r.key} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td data-label="Направление" className={`${td} font-medium`}>
                      {r.label}
                    </td>
                    <td data-label="Заявок" className={`${td} text-right tabular-nums`}>
                      {r.orders}
                    </td>
                    <td data-label="Стеблей" className={`${td} text-right tabular-nums`}>
                      {nf(r.stems)}
                    </td>
                    <td data-label="Сумма" className={`${td} text-right tabular-nums`}>
                      {money(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
      <Pager total={total} page={page} onPage={setPage} what="строк" />
    </div>
  );
}
