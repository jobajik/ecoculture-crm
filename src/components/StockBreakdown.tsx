"use client";

import { useState } from "react";
import clsx from "clsx";
import type { StockRow } from "@/lib/stockAnalytics";
import Change from "./Change";

type View = "flower" | "grade" | "variety";

const VIEWS: { key: View; label: string; column: string }[] = [
  { key: "flower", label: "Цветы", column: "Цветок" },
  { key: "grade", label: "Ростовка и категория", column: "Позиция" },
  { key: "variety", label: "Сорта", column: "Сорт" },
];

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Разрезы склада одной таблицей с переключателем — как «Разрезы месяца» у клиентов. */
export default function StockBreakdown({ rows, hasPrev }: { rows: Record<View, StockRow[]>; hasPrev: boolean }) {
  const [view, setView] = useState<View>("flower");
  const list = rows[view];
  const cfg = VIEWS.find((v) => v.key === view)!;

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
              <th className="px-4 py-2.5 font-medium">{cfg.column}</th>
              <th className="px-3 py-2.5 font-medium text-right">Приход</th>
              <th className="px-3 py-2.5 font-medium text-right">Отгружено</th>
              {hasPrev && <th className="px-3 py-2.5 font-medium text-right">к прошлому</th>}
              <th className="px-3 py-2.5 font-medium text-right">Списано</th>
              <th className="px-3 py-2.5 font-medium text-right">Сотр. и нужды</th>
              <th className="px-3 py-2.5 font-medium text-right">Остаток сейчас</th>
              <th className="px-4 py-2.5 font-medium text-right">Хватит, дн.</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key} className="border-b border-line-hairline/70 last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.label}</td>
                <td data-label="Приход" className="px-3 py-2.5 text-right tabular-nums">{r.received ? nf(r.received) : ""}</td>
                <td data-label="Отгружено" className="px-3 py-2.5 text-right tabular-nums font-medium">{r.shipped ? nf(r.shipped) : ""}</td>
                {hasPrev && (
                  <td data-label="к прошлому" className="px-3 py-2.5 text-right tabular-nums">
                    <Change now={r.shipped} before={r.prevShipped} />
                  </td>
                )}
                <td
                  data-label="Списано"
                  className={clsx("px-3 py-2.5 text-right tabular-nums whitespace-nowrap", (r.writeoffPercent ?? 0) >= 10 && "text-status-critical")}
                >
                  {r.writtenOff ? nf(r.writtenOff) : ""}
                  {r.writtenOff > 0 && r.writeoffPercent !== null && (
                    <span className="ml-1 text-xs text-ink-muted">{Math.round(r.writeoffPercent)} %</span>
                  )}
                </td>
                <td data-label="Сотр. и нужды" className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{r.other ? nf(r.other) : ""}</td>
                <td data-label="Остаток сейчас" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {r.stockNow ? nf(r.stockNow) : ""}
                  {r.expiredNow > 0 && (
                    <span className="block text-[11px] text-status-critical">старше срока {nf(r.expiredNow)}</span>
                  )}
                </td>
                <td
                  data-label="Хватит, дн."
                  className={clsx("px-4 py-2.5 text-right tabular-nums", r.coverDays !== null && r.coverDays > 10 && "text-[#8a5a00]")}
                >
                  {r.coverDays !== null ? nf(r.coverDays) : r.stockNow > 0 ? <span className="text-xs text-[#8a5a00]">не отгружали</span> : ""}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-muted">
                  За месяц движения нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
