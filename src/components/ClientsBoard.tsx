"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import Pager, { pageSlice } from "./Pager";
import Chips from "./Chips";
import { clients as clientsWord, days, orders as ordersWord } from "@/lib/plural";

export interface ClientRowView {
  clientId: string;
  name: string;
  city: string;
  shopName: string;
  clientType: string;
  phone: string;
  managerName: string;
  orders: number;
  revenue: number;
  debt: number;
  avgCheck: number;
  lastOrderDate: string;
  daysSinceLast: number;
  sleeping: boolean;
  neverOrdered: boolean;
  topPosition: string;
  active: boolean;
}

export interface GroupView {
  key: string;
  label: string;
  clients: number;
  orders: number;
  revenue: number;
  share: number;
  avgCheck: number;
}

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/** «5 дней назад» / «сегодня» — человеку так понятнее, чем дата. */
function whenLabel(row: ClientRowView): string {
  if (row.neverOrdered) return "заказов не было";
  if (row.daysSinceLast <= 0) return "сегодня";
  if (row.daysSinceLast === 1) return "вчера";
  return `${days(row.daysSinceLast)} назад`;
}

type Filter = "all" | "sleeping" | "never" | "debt" | "mine";

/**
 * Клиентская база: список с разрезами.
 *
 * Устроена как отчёт, а не как справочник: сверху видно, кто сколько принёс,
 * кто молчит и кто должен, а карточка открывается кликом. Справочник «список
 * имён» не отвечает ни на один рабочий вопрос — а «кому позвонить, потому что
 * месяц не заказывал» отвечает.
 */
export default function ClientsBoard({
  rows,
  byManager,
  byCity,
  byType,
  myManagerName,
}: {
  rows: ClientRowView[];
  byManager: GroupView[];
  byCity: GroupView[];
  byType: GroupView[];
  /** Имя того, кто смотрит, — для фильтра «мои». */
  myManagerName: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  // Вид карточки: список клиентов или разрезы — на одном экране, без прокрутки (19.10.2026).
  const [view, setView] = useState<"list" | "manager" | "city" | "type">("list");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "sleeping" && !r.sleeping) return false;
      if (filter === "never" && !r.neverOrdered) return false;
      if (filter === "debt" && r.debt <= 0) return false;
      if (filter === "mine" && r.managerName !== myManagerName) return false;
      if (
        q &&
        ![r.name, r.shopName, r.city, r.phone, r.managerName].some((f) =>
          f.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      return true;
    });
  }, [rows, search, filter, myManagerName]);

  // Новый фильтр или поиск — с первой страницы.
  useEffect(() => setPage(0), [filter, search]);
  const shown = pageSlice(filtered, page);
  const groups = view === "manager" ? byManager : view === "city" ? byCity : view === "type" ? byType : [];

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
        {(
          [
            ["list", `Клиенты (${rows.length.toLocaleString("ru-RU")})`],
            ["manager", "По менеджерам"],
            ["city", "По городам"],
            ["type", "По типу точки"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={clsx(
              "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
              view === key ? "border-section-client text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "list" ? (
        <>
          <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
            <Chips
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              items={[
                { value: "all", label: "Все", count: rows.length },
                { value: "mine", label: "Мои", count: rows.filter((r) => r.managerName === myManagerName).length },
                { value: "sleeping", label: "Молчат", count: rows.filter((r) => r.sleeping).length },
                { value: "debt", label: "Должны", count: rows.filter((r) => r.debt > 0).length, alarm: true },
                { value: "never", label: "Без заказов", count: rows.filter((r) => r.neverOrdered).length },
              ]}
            />
            <input
              className="input !w-auto xl:ml-auto xl:w-[260px] min-w-0"
              placeholder="Название, город, телефон"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                  <th className="px-4 py-2.5 font-medium">Клиент</th>
                  <th className="px-4 py-2.5 font-medium">Город</th>
                  <th className="px-4 py-2.5 font-medium">Менеджер</th>
                  <th className="px-4 py-2.5 font-medium text-right">Заявок</th>
                  <th className="px-4 py-2.5 font-medium text-right">Выручка</th>
                  <th className="px-4 py-2.5 font-medium text-right">Средний чек</th>
                  <th className="px-4 py-2.5 font-medium">Последний заказ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.clientId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td data-label="Клиент" className="px-4 py-2.5">
                      <Link href={`/clients/${r.clientId}`} className="font-semibold hover:text-section-client">
                        {r.name}
                      </Link>
                      <span className="block text-xs text-ink-muted truncate max-w-[260px]">
                        {[r.shopName, r.clientType].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </td>
                    <td data-label="Город" className="px-4 py-2.5">{r.city || "—"}</td>
                    <td data-label="Менеджер" className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{r.managerName}</td>
                    <td data-label="Заявок" className="px-4 py-2.5 text-right tabular-nums">{r.orders || "—"}</td>
                    <td data-label="Выручка" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.revenue > 0 ? money(r.revenue) : "—"}
                      {r.debt > 0 && <span className="block text-xs text-status-critical">долг {money(r.debt)}</span>}
                    </td>
                    <td data-label="Средний чек" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.avgCheck > 0 ? money(r.avgCheck) : "—"}
                    </td>
                    <td
                      data-label="Последний заказ"
                      className={clsx("px-4 py-2.5 whitespace-nowrap", r.sleeping ? "text-[#8a5a00]" : "text-ink-secondary")}
                    >
                      {whenLabel(r)}
                      {r.topPosition && <span className="block text-xs text-ink-muted">берёт {r.topPosition}</span>}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                      Клиентов нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager total={filtered.length} page={page} onPage={setPage} what="клиентов" />
        </>
      ) : (
        <GroupTable rows={groups} />
      )}
    </div>
  );
}

function GroupTable({ rows }: { rows: GroupView[] }) {
  if (rows.length === 0) return <p className="px-5 py-10 text-center text-sm text-ink-muted">Пока пусто</p>;
  return (
    <div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="border-b border-line-hairline last:border-0">
              <td className="px-4 py-2.5">
                {g.label}
                <span className="block text-xs text-ink-muted">
                  {clientsWord(g.clients)} · {ordersWord(g.orders)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                {money(g.revenue)}
                <span className="block text-xs text-ink-muted">{Math.round(g.share)} %</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
