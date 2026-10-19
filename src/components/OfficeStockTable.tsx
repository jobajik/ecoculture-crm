"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";

/** Строка остатка офиса: позиция целиком, сколько лежит и сколько дней самое старое. Считает сервер. */
export interface OfficeStockRow {
  key: string;
  flowerType: string;
  flower: string;
  variety: string;
  grade: string;
  gradeLabel: string;
  qty: number;
  oldest: number;
  status: string;
}

/**
 * Что лежит в офисе — таблица с отбором кнопками, поиском и страницами (новый вид, 19.10.2026). Раньше это была
 * сплошная таблица на всю высоту страницы.
 */
export default function OfficeStockTable({
  rows,
  gradeHeader,
  emptyText,
}: {
  rows: OfficeStockRow[];
  gradeHeader: string;
  emptyText: string;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, search]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      rows.filter(
        (r) => match(r, filter) && (!q || `${r.flower} ${r.variety} ${r.gradeLabel}`.toLowerCase().includes(q))
      ),
    [rows, filter, q]
  );
  const flowers = Array.from(new Map(rows.map((r) => [r.flowerType, r.flower])).entries());
  const count = (f: string) => rows.filter((r) => match(r, f)).length;
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
        <Chips
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Все", count: rows.length },
            ...(flowers.length > 1 ? flowers.map(([value, label]) => ({ value, label, count: count(value) })) : []),
            ...(count("critical") > 0 || filter === "critical"
              ? [{ value: "critical", label: "Дольше срока", count: count("critical"), alarm: true }]
              : []),
            ...(count("warning") > 0 || filter === "warning" ? [{ value: "warning", label: "Скоро срок", count: count("warning") }] : []),
          ]}
        />
        <input
          className="input !w-auto xl:ml-auto xl:w-[240px] min-w-0"
          placeholder="Найти сорт…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">Цветок</th>
              <th className="px-3 py-2.5 font-medium">Сорт</th>
              <th className="px-3 py-2.5 font-medium">{gradeHeader}</th>
              <th className="px-3 py-2.5 font-medium text-right">Шт.</th>
              <th className="px-4 py-2.5 font-medium text-right">Лежит</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice(visible, page).map((r) => (
              <tr key={r.key} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                <td className="px-4 py-2.5">{r.flower}</td>
                <td data-label="Сорт" className="px-3 py-2.5">
                  {r.variety}
                </td>
                <td data-label={gradeHeader} className="px-3 py-2.5">
                  {r.gradeLabel}
                </td>
                <td data-label="Шт." className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {nf(r.qty)}
                </td>
                <td
                  data-label="Лежит"
                  className={clsx(
                    "px-4 py-2.5 text-right whitespace-nowrap",
                    r.status === "critical" ? "text-status-critical font-semibold" : r.status === "warning" ? "text-[#8a5a00]" : "text-ink-secondary"
                  )}
                >
                  {r.oldest} дн.
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  {rows.length === 0 ? emptyText : "Ничего не нашлось."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={visible.length} page={page} onPage={setPage} what="позиций" />
    </div>
  );
}

/** Отбор: «все», цветок или состояние хранения самой старой партии позиции. */
function match(r: OfficeStockRow, f: string): boolean {
  return f === "all" || (f === "critical" || f === "warning" ? r.status === f : r.flowerType === f);
}
