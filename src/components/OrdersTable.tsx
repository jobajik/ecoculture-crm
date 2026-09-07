"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ORDER_STATUS_LABELS, FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { OrderWithItems } from "@/lib/types";
import OrderStatusBadge from "./OrderStatusBadge";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";

export default function OrdersTable({ orders }: { orders: OrderWithItems[] }) {
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = `${o.clientName} ${o.managerEmail} ${o.orderId}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [orders, status, search]);

  // Заявок со временем накопится много. Показываем начало списка, остальное по
  // кнопке; при поиске и фильтре по статусу показываем всё найденное — там
  // список человек сузил сам.
  const [expanded, setExpanded] = useState(false);
  const narrowed = status !== "all" || search.trim().length > 0;
  const shown = expanded || narrowed ? filtered : filtered.slice(0, COLLAPSED_TABLE_SIZE);
  const hidden = filtered.length - shown.length;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input !w-auto">
          <option value="all">Все статусы</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input !w-auto flex-1 min-w-[200px]"
          placeholder="Поиск по клиенту, менеджеру, номеру заявки"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Заявка</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium">Позиции</th>
              <th className="px-4 py-3 font-medium">Сумма</th>
              <th className="px-4 py-3 font-medium">Доставка</th>
              <th className="px-4 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                <td className="px-4 py-3">
                  <Link href={`/orders/${o.orderId}`} className="text-series-1 font-medium">
                    {o.orderId}
                  </Link>
                  <div className="text-xs text-ink-muted">
                    {new Date(o.createdAt).toLocaleDateString("ru-RU")}
                  </div>
                </td>
                <td className="px-4 py-3">{o.clientName}</td>
                <td className="px-4 py-3 text-ink-secondary">{o.managerEmail}</td>
                <td className="px-4 py-3 text-ink-secondary">
                  {o.items
                    .map((i) => `${FLOWER_TYPE_LABELS[i.flowerType]} ${i.variety} ×${i.quantity}`)
                    .join(", ")}
                </td>
                <td className="px-4 py-3 font-medium">{o.totalAmount.toLocaleString("ru-RU")} ₸</td>
                <td className="px-4 py-3 text-ink-secondary">
                  {o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString("ru-RU") : "—"}
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={o.status} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  Заявок не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(hidden > 0 || (expanded && !narrowed)) && (
        <div className="mt-2 flex items-center gap-3">
          <MoreToggle
            expanded={expanded}
            hidden={hidden}
            onToggle={() => setExpanded((v) => !v)}
            what="заявок"
          />
          <span className="text-xs text-ink-muted">
            всего заявок: {filtered.length.toLocaleString("ru-RU")}
          </span>
        </div>
      )}
    </div>
  );
}
