"use client";

import { useEffect, useMemo, useState } from "react";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";

/** Строка журнала перемещений, уже готовая к показу (сервер подставил имя и подпись позиции). */
export interface OfficeMoveRow {
  id: string;
  when: string;
  toOffice: boolean;
  label: string;
  note: string;
  quantity: number;
  who: string;
}

/** Журнал перемещений склад ⇄ офис: отбор по направлению, поиск и страницы (новый вид, 19.10.2026). */
export default function OfficeMovesTable({ rows }: { rows: OfficeMoveRow[] }) {
  const [dir, setDir] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [dir, search]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (dir === "all" || (dir === "in" ? r.toOffice : !r.toOffice)) &&
          (!q || `${r.label} ${r.who} ${r.note}`.toLowerCase().includes(q))
      ),
    [rows, dir, q]
  );
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
        <Chips
          value={dir}
          onChange={setDir}
          items={[
            { value: "all", label: "Все", count: rows.length },
            { value: "in", label: "Склад → Офис", count: rows.filter((r) => r.toOffice).length },
            { value: "back", label: "Офис → Склад", count: rows.filter((r) => !r.toOffice).length },
          ]}
        />
        <input
          className="input !w-auto xl:ml-auto xl:w-[240px] min-w-0"
          placeholder="Сорт, кто"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">Когда</th>
              <th className="px-3 py-2.5 font-medium">Куда</th>
              <th className="px-3 py-2.5 font-medium">Позиция</th>
              <th className="px-3 py-2.5 font-medium text-right">Шт.</th>
              <th className="px-4 py-2.5 font-medium">Кто</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice(visible, page).map((m) => (
              <tr key={m.id} className="border-b border-line-hairline last:border-0 align-top hover:bg-surface-plane">
                <td className="px-4 py-2.5 whitespace-nowrap">{m.when}</td>
                <td data-label="Куда" className="px-3 py-2.5 whitespace-nowrap">
                  {m.toOffice ? "Склад → Офис" : "Офис → Склад"}
                </td>
                <td data-label="Позиция" className="px-3 py-2.5">
                  {m.label}
                  {m.note && <div className="text-xs text-ink-muted">{m.note}</div>}
                </td>
                <td data-label="Шт." className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {nf(m.quantity)}
                </td>
                <td data-label="Кто" className="px-4 py-2.5 text-ink-secondary">
                  {m.who}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  {rows.length === 0 ? "Перемещений за 30 дней не было." : "Ничего не нашлось."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={visible.length} page={page} onPage={setPage} what="перемещений" />
    </div>
  );
}
