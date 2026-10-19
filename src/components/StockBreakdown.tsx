"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { StockRow } from "@/lib/stockAnalytics";
import Change from "./Change";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";

type View = "flower" | "grade" | "variety";

const VIEWS: { key: View; label: string; column: string }[] = [
  { key: "flower", label: "Цветы", column: "Цветок" },
  { key: "grade", label: "Ростовка и категория", column: "Позиция" },
  { key: "variety", label: "Сорта", column: "Сорт" },
];

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

/**
 * Разрезы склада одной таблицей с переключателем — как «Разрезы месяца» у клиентов. Новый вид (19.10.2026): живёт
 * вкладкой внутри карточки аналитики, разрез выбирается кнопками, длинный список сортов — страницами.
 */
export default function StockBreakdown({ rows, hasPrev }: { rows: Record<View, StockRow[]>; hasPrev: boolean }) {
  const [view, setView] = useState<View>("flower");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [view]);
  const list = rows[view];
  const cfg = VIEWS.find((v) => v.key === view)!;

  return (
    <div>
      <div className="px-4 py-3 border-b border-line-hairline">
        <Chips
          value={view}
          onChange={(v) => setView(v as View)}
          items={VIEWS.map((v) => ({ value: v.key, label: v.label, count: rows[v.key].length }))}
        />
      </div>

      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
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
            {pageSlice(list, page).map((r) => (
              <tr key={r.key} className="border-b border-line-hairline/70 last:border-0 hover:bg-surface-plane">
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
      <Pager total={list.length} page={page} onPage={setPage} what="строк" />
    </div>
  );
}
