"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";

/** Строка справочника магазинов — сервер уже посчитал заявки и давность последней доставки. */
export interface RetailShopRow {
  clientId: string;
  name: string;
  city: string;
  territory: string;
  active: boolean;
  orders: number;
  stems: number;
  amount: number;
  lastLabel: string;
  /** Дней с последней доставки; null — ещё не возили. */
  daysAgo: number | null;
}

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/** Справочник наших точек одной карточкой: отбор кнопками, поиск и страницы (новый вид, 19.10.2026). */
export default function RetailShopsTable({
  rows,
  showTerritory,
  canOrder,
  quietDays,
}: {
  rows: RetailShopRow[];
  showTerritory: boolean;
  canOrder: boolean;
  /** Сколько дней без доставки — повод проверить точку: забытая заявка или магазин закрылся. */
  quietDays: number;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, search]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((r) => matches(r, filter, quietDays) && (!q || `${r.name} ${r.city} ${r.territory}`.toLowerCase().includes(q))),
    [rows, filter, q, quietDays]
  );
  const count = (f: string) => rows.filter((r) => matches(r, f, quietDays)).length;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
        <Chips
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Все", count: rows.length },
            { value: "quiet", label: `Не возили ${quietDays}+ дней`, count: count("quiet"), alarm: true },
            { value: "never", label: "Ещё не возили", count: count("never") },
            ...(count("closed") > 0 || filter === "closed" ? [{ value: "closed", label: "Не работают", count: count("closed") }] : []),
          ]}
        />
        <input
          className="input !w-auto xl:ml-auto xl:w-[240px] min-w-0"
          placeholder="Магазин, город"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">Магазин</th>
              <th className="px-4 py-2.5 font-medium">Город</th>
              {showTerritory && <th className="px-4 py-2.5 font-medium">Направление</th>}
              <th className="px-4 py-2.5 font-medium text-right">Заявок</th>
              <th className="px-4 py-2.5 font-medium text-right">Стеблей</th>
              <th className="px-4 py-2.5 font-medium text-right">По внутр. цене</th>
              <th className="px-4 py-2.5 font-medium">Последняя доставка</th>
              {canOrder && <th className="px-4 py-2.5 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {pageSlice(visible, page).map((r) => (
              <tr key={r.clientId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                <td data-label="Магазин" className="px-4 py-2.5">
                  <Link href={`/clients/${r.clientId}`} className="font-semibold hover:text-section-retail">
                    {r.name}
                  </Link>
                  {!r.active && <span className="ml-2 text-xs text-ink-muted">не работает</span>}
                </td>
                <td data-label="Город" className="px-4 py-2.5 text-ink-secondary">
                  {r.city || "—"}
                </td>
                {showTerritory && (
                  <td data-label="Направление" className="px-4 py-2.5 text-ink-secondary">
                    {r.territory}
                  </td>
                )}
                <td data-label="Заявок" className="px-4 py-2.5 text-right tabular-nums">
                  {r.orders}
                </td>
                <td data-label="Стеблей" className="px-4 py-2.5 text-right tabular-nums">
                  {r.orders > 0 ? r.stems.toLocaleString("ru-RU") : "—"}
                </td>
                <td data-label="По внутр. цене" className="px-4 py-2.5 text-right tabular-nums">
                  {r.orders > 0 ? money(r.amount) : "—"}
                </td>
                <td
                  data-label="Последняя доставка"
                  className={clsx(
                    "px-4 py-2.5 whitespace-nowrap",
                    r.active && r.daysAgo !== null && r.daysAgo >= quietDays ? "text-status-critical font-semibold" : "text-ink-secondary"
                  )}
                >
                  {r.lastLabel}
                  {r.daysAgo !== null && r.daysAgo > 0 && <span className="block text-xs font-normal">{r.daysAgo} дн. назад</span>}
                </td>
                {canOrder && (
                  <td className="px-4 py-2.5 sm:text-right whitespace-nowrap">
                    <Link href={`/orders/new?retail=1&client=${r.clientId}`} className="btn-secondary !py-1.5 !px-3 text-xs">
                      Заявка
                    </Link>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink-muted">
                  {rows.length === 0 ? "Магазинов пока нет." : "Ничего не нашлось."}
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

function matches(r: RetailShopRow, f: string, quietDays: number): boolean {
  if (f === "quiet") return r.active && r.daysAgo !== null && r.daysAgo >= quietDays;
  if (f === "never") return r.daysAgo === null;
  if (f === "closed") return !r.active;
  return true;
}
