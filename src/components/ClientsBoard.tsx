"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
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
  const [expanded, setExpanded] = useState(false);

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

  const narrowed = filter !== "all" || search.trim().length > 0;
  const shown = expanded || narrowed ? filtered : filtered.slice(0, COLLAPSED_TABLE_SIZE);

  const tab = (key: Filter, label: string, count?: number) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={clsx(
        "px-3 py-1.5 rounded-lg text-sm whitespace-nowrap",
        filter === key ? "bg-surface-plane font-medium" : "text-ink-secondary hover:bg-surface-plane"
      )}
    >
      {label}
      {count !== undefined && count > 0 && <span className="text-ink-muted"> · {count}</span>}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tab("all", "Все", rows.length)}
        {tab("mine", "Мои", rows.filter((r) => r.managerName === myManagerName).length)}
        {tab("sleeping", "Молчат", rows.filter((r) => r.sleeping).length)}
        {tab("debt", "Должны", rows.filter((r) => r.debt > 0).length)}
        {tab("never", "Без заказов", rows.filter((r) => r.neverOrdered).length)}
        <input
          className="input !w-auto flex-1 min-w-[200px] !py-1.5"
          placeholder="Поиск по названию, городу, телефону"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Город</th>
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium text-right">Заявок</th>
              <th className="px-4 py-3 font-medium text-right">Выручка</th>
              <th className="px-4 py-3 font-medium text-right">Средний чек</th>
              <th className="px-4 py-3 font-medium">Последний заказ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.clientId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                <td className="px-4 py-2.5">
                  <Link href={`/clients/${r.clientId}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="block text-xs text-ink-muted">
                    {[r.shopName, r.clientType].filter(Boolean).join(" · ") || "—"}
                  </span>
                </td>
                <td className="px-4 py-2.5">{r.city || "—"}</td>
                <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{r.managerName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.orders || "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {r.revenue > 0 ? money(r.revenue) : "—"}
                  {r.debt > 0 && (
                    <span className="block text-xs text-[#8a5a00]">долг {money(r.debt)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {r.avgCheck > 0 ? money(r.avgCheck) : "—"}
                </td>
                <td
                  className={clsx(
                    "px-4 py-2.5 whitespace-nowrap",
                    r.sleeping ? "text-[#8a5a00]" : "text-ink-secondary"
                  )}
                >
                  {whenLabel(r)}
                  {r.topPosition && (
                    <span className="block text-xs text-ink-muted">берёт {r.topPosition}</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                  По этому фильтру клиентов нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!narrowed && (
        <MoreToggle
          expanded={expanded}
          hidden={filtered.length - shown.length}
          onToggle={() => setExpanded((v) => !v)}
          what="клиентов"
        />
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <GroupTable title="По менеджерам" rows={byManager} />
        <GroupTable title="По городам" rows={byCity} />
        <GroupTable title="По типу точки" rows={byType} />
      </div>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupView[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line-hairline font-medium">{title}</div>
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
