"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";
import Pill from "./Pill";
import type { ShopDayRow } from "@/lib/retail";

export type RetailDayRow = ShopDayRow & {
  /** «Алматы · Алматы» — город и направление, подпись под названием. */
  sub: string;
};

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/**
 * Заявка на день по магазинам (новый вид, 19.10.2026): отбор кнопками — «без заявки» первым делом, поиск и страницы.
 * Пустая строка здесь — напоминание: забытый магазин остаётся без цветка.
 */
export default function RetailDayBoard({
  rows,
  date,
  canOrder,
}: {
  rows: RetailDayRow[];
  date: string;
  canOrder: boolean;
}) {
  const missing = rows.filter((r) => r.empty).length;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, search, date]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((r) => matches(r, filter) && (!q || `${r.name} ${r.sub}`.toLowerCase().includes(q))),
    [rows, filter, q]
  );
  const count = (f: string) => rows.filter((r) => matches(r, f)).length;

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
        <Chips
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Все", count: rows.length },
            { value: "empty", label: "Без заявки", count: missing, alarm: true },
            { value: "wait", label: "Ждут подтверждения", count: count("wait") },
            { value: "ok", label: "Подтверждены", count: count("ok") },
          ]}
        />
        <input
          className="input !w-auto xl:ml-auto xl:w-[240px] min-w-0"
          placeholder="Найти магазин…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">Магазин</th>
              <th className="px-4 py-2.5 font-medium">Что заказано</th>
              <th className="px-4 py-2.5 font-medium text-right">Стеблей</th>
              <th className="px-4 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-4 py-2.5 font-medium">Готовность</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice(visible, page).map((row) => (
              <tr key={row.clientId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top">
                <td data-label="Магазин" className="px-4 py-2.5">
                  <Link href={`/clients/${row.clientId}`} className="font-semibold hover:text-section-retail">
                    {row.name}
                  </Link>
                  {row.sub && <div className="text-xs text-ink-muted">{row.sub}</div>}
                </td>
                <td data-label="Что заказано" className="px-4 py-2.5 text-ink-secondary">
                  {row.empty ? (
                    <span className="text-[#8a5a00]">заявки нет</span>
                  ) : (
                    row.orders.map((o) => (
                      <div key={o.orderId} className="max-w-[360px] truncate" title={o.positions}>
                        <Link href={`/orders/${o.orderId}`} className="hover:underline">
                          {o.positions || "без позиций"}
                        </Link>
                      </div>
                    ))
                  )}
                </td>
                <td data-label="Стеблей" className="px-4 py-2.5 text-right tabular-nums">
                  {row.stems > 0 ? row.stems.toLocaleString("ru-RU") : "—"}
                </td>
                <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums">
                  {row.amount > 0 ? money(row.amount) : "—"}
                </td>
                <td data-label="Готовность" className="px-4 py-2.5">
                  {row.empty ? (
                    canOrder ? (
                      // Магазин и день уже выбраны здесь — на форме остаётся ввести количество.
                      <Link href={`/orders/new?retail=1&client=${row.clientId}&date=${date}`} className="btn-primary !py-1.5 !px-3 text-xs">
                        Оформить
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )
                  ) : row.orders.every((o) => o.managerConfirmed) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone="good">подтверждена</Pill>
                      {canOrder && (
                        <Link
                          href={`/orders/new?retail=1&client=${row.clientId}&date=${date}`}
                          className="text-xs text-ink-secondary hover:underline"
                          title="Добор: вторая заявка на тот же день"
                        >
                          добавить
                        </Link>
                      )}
                    </div>
                  ) : (
                    <Pill tone="wait">ждёт подтверждения</Pill>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  {rows.length === 0 ? "Магазинов пока нет" : filter === "empty" && !q ? "У всех магазинов заявка есть" : "Ничего не нашлось"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={visible.length} page={page} onPage={setPage} what="магазинов" />
    </div>
  );
}

function matches(r: RetailDayRow, f: string): boolean {
  if (f === "empty") return r.empty;
  if (f === "ok") return !r.empty && r.orders.every((o) => o.managerConfirmed);
  if (f === "wait") return !r.empty && !r.orders.every((o) => o.managerConfirmed);
  return true;
}
