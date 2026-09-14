"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ORDER_STATUS_LABELS, FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { OrderWithItems } from "@/lib/types";
import OrderStatusBadge from "./OrderStatusBadge";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import { formatDay } from "@/lib/formatDate";
import { isReadyToShip, notReadyReason } from "@/lib/orderReady";
import { personName, type NameByEmail } from "@/lib/personName";

/**
 * Список заявок.
 *
 * **Строки одной высоты — это не про красоту.** В заявке бывает одна позиция, а
 * бывает девять, и колонка «Позиции» растягивала строку на четыре ряда текста.
 * Соседние строки при этом оставались в один ряд, и глаз, идущий по списку
 * сверху вниз, каждый раз терял, где он: колонка «Сумма» одной заявки
 * оказывалась на уровне «Клиента» соседней. Владелец прислал снимок именно с
 * этим.
 *
 * Поэтому каждая ячейка теперь занимает **ровно одну строку текста**: длинное
 * имя клиента и длинная причина обрезаются (полный текст — во всплывающей
 * подсказке), номер заявки не переносится, а позиции свёрнуты до первой плюс
 * «ещё N». Развернуть можно любую строку по отдельности — тогда она и станет
 * выше, но это будет осознанным действием человека, а не сюрпризом.
 *
 * Свёрнута именно ПЕРВАЯ позиция, а не «Розы, 9 позиций»: в девяти случаях из
 * десяти заявка про один цветок, и первая строка отвечает на вопрос «что это»
 * без раскрытия. Число рядом отвечает на второй вопрос — «а сколько там ещё».
 */
export default function OrdersTable({
  orders,
  managerNames = {},
}: {
  orders: OrderWithItems[];
  /** Почта → имя из вкладки `Users`. Без неё в колонке стоял бы адрес. */
  managerNames?: NameByEmail;
}) {
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Какие заявки человек раскрыл. По одной, а не «раскрыть все»: раскрытие
  // ломает ровную сетку, и делать это должен тот, кому оно понадобилось.
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

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

  function toggleItems(orderId: string) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const itemText = (i: OrderWithItems["items"][number]) =>
    `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety} ×${i.quantity.toLocaleString("ru-RU")}`;

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
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
              <th className="px-4 py-3 font-medium">Доставка</th>
              <th className="px-4 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => {
              const itemsOpen = openItems.has(o.orderId);
              const rest = o.items.length - 1;
              const reason = o.status === "new" && !isReadyToShip(o) ? notReadyReason(o) : "";
              return (
                <tr
                  key={o.orderId}
                  className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top"
                >
                  <td className="px-4 py-3">
                    {/* Номер не переносится: «ORD-260914-T85ZC» ломался на три
                        строки и в одиночку задирал высоту всей строки. */}
                    <Link
                      href={`/orders/${o.orderId}`}
                      className="text-series-1 font-medium whitespace-nowrap"
                    >
                      {o.orderId}
                    </Link>
                    <div className="text-xs text-ink-muted">{formatDay(o.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="truncate max-w-[200px]" title={o.clientName}>
                      {o.clientName}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    <div className="truncate max-w-[130px]">
                      {personName(o.managerEmail, managerNames)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {itemsOpen ? (
                      <div className="max-w-[340px]">
                        {o.items.map((i, idx) => (
                          <div key={idx}>{itemText(i)}</div>
                        ))}
                        <button
                          type="button"
                          onClick={() => toggleItems(o.orderId)}
                          className="text-xs text-series-1 hover:underline mt-1"
                        >
                          свернуть
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2 max-w-[340px]">
                        <span className="truncate" title={o.items.map(itemText).join(", ")}>
                          {o.items.length > 0 ? itemText(o.items[0]) : "—"}
                        </span>
                        {rest > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleItems(o.orderId)}
                            className="text-xs text-series-1 hover:underline whitespace-nowrap shrink-0"
                          >
                            ещё {rest}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-right whitespace-nowrap tabular-nums">
                    {o.totalAmount.toLocaleString("ru-RU")} ₸
                  </td>
                  <td className="px-4 py-3 text-ink-secondary whitespace-nowrap">
                    {formatDay(o.deliveryDate)}
                  </td>
                  {/* Под статусом — готовность к сборке. Статус отвечает на
                      вопрос «где заявка в своей жизни», готовность — на вопрос
                      «что мешает её собрать», и это разные вопросы. Раньше
                      второй ответ был только внутри заявки: в списке у всех
                      строк стояло одинаковое «Новая», и понять, какая из своих
                      заявок застряла, можно было только открыв каждую. */}
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={o.status} />
                    {o.status === "new" &&
                      (isReadyToShip(o) ? (
                        <div className="text-xs text-status-good mt-1 whitespace-nowrap">
                          ✓✓ можно собирать
                        </div>
                      ) : (
                        // Причина обрезается по ширине, а не переносится: целиком
                        // она есть в подсказке и на самой заявке, а здесь важнее,
                        // чтобы строки списка стояли ровно.
                        <div
                          className="text-xs text-ink-muted mt-1 truncate max-w-[150px]"
                          title={reason}
                        >
                          {reason}
                        </div>
                      ))}
                  </td>
                </tr>
              );
            })}
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
