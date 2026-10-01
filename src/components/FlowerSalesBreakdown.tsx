"use client";

import { useState } from "react";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { FlowerSalesRow } from "@/lib/flowerSales";
import Change from "./Change";

type View = "grade" | "variety" | "manager" | "flower";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;

/**
 * Разрезы проданного за месяц одной таблицей с переключателем — как у склада и
 * клиентов. Расчёт — `buildFlowerSales()` в `src/lib/flowerSales.ts`.
 */
export default function FlowerSalesBreakdown({
  rows,
  gradeLabel,
  oneFlower,
  hasPrev,
}: {
  rows: Record<View, FlowerSalesRow[]>;
  /** «Ростовка», «Категория» или «Ростовка и категория». */
  gradeLabel: string;
  /** Выбран один цветок — вкладка «Цветы» не нужна, подпись цветка у строк тоже. */
  oneFlower: boolean;
  hasPrev: boolean;
}) {
  const views: { key: View; label: string; column: string }[] = [
    { key: "grade", label: gradeLabel, column: gradeLabel },
    { key: "variety", label: "Сорта", column: "Сорт" },
    { key: "manager", label: "Менеджеры", column: "Менеджер" },
    ...(oneFlower ? [] : [{ key: "flower" as View, label: "Цветы", column: "Цветок" }]),
  ];
  const [view, setView] = useState<View>("grade");
  const cfg = views.find((v) => v.key === view) ?? views[0];
  const list = rows[cfg.key];
  const maxShare = Math.max(1, ...list.filter((r) => !r.aside).map((r) => r.share));

  return (
    <section className="card !p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="font-semibold">Что продали</h2>
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line-hairline bg-surface-plane p-1" role="tablist">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={cfg.key === v.key}
              onClick={() => setView(v.key)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
                cfg.key === v.key ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary"
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
              <th className="px-4 py-2.5 font-medium">{cfg.column}</th>
              <th className="px-3 py-2.5 font-medium text-right">Штук</th>
              <th className="px-3 py-2.5 font-medium">Доля</th>
              {hasPrev && <th className="px-3 py-2.5 font-medium text-right">к прошлому</th>}
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-3 py-2.5 font-medium text-right">Ср. цена</th>
              <th className="px-4 py-2.5 font-medium text-right">Заявок</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key} className={clsx("border-b border-line-hairline/70 last:border-0", r.aside && "text-ink-secondary bg-surface-plane/60")}>
                <td className="px-4 py-2.5 font-medium">
                  {r.label}
                  {!oneFlower && r.flowerType && cfg.key !== "flower" && (
                    <span className="ml-1.5 text-xs font-normal text-ink-muted">{FLOWER_TYPE_LABELS[r.flowerType]?.toLowerCase()}</span>
                  )}
                  {r.aside && <span className="block text-[11px] font-normal text-ink-muted">не продажа, в итог не входит</span>}
                </td>
                <td data-label="Штук" className="px-3 py-2.5 text-right tabular-nums font-medium">{nf(r.stems)}</td>
                <td data-label="Доля" className="px-3 py-2.5">
                  {!r.aside && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-plane">
                        <div className="h-full rounded-full bg-section-sales" style={{ width: `${Math.max(2, (r.share / maxShare) * 100)}%` }} />
                      </div>
                      <span className="tabular-nums text-xs text-ink-secondary">{Math.round(r.share)} %</span>
                    </div>
                  )}
                </td>
                {hasPrev && (
                  <td data-label="к прошлому" className="px-3 py-2.5 text-right tabular-nums">
                    <Change now={r.stems} before={r.prevStems} />
                  </td>
                )}
                <td data-label="Сумма" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{money(r.amount)}</td>
                <td data-label="Ср. цена" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {r.stems > 0 ? money(r.amount / r.stems) : ""}
                </td>
                <td data-label="Заявок" className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{nf(r.orders)}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  За месяц продаж нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
