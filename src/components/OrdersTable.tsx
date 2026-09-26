"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import type { OrderWithItems } from "@/lib/types";
import OrderStageBadge from "./OrderStageBadge";
import ItemsCell from "./ItemsCell";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import { formatDay } from "@/lib/formatDate";
import { byUrgency, orderStage, STAGE_LABELS, STAGE_ORDER, type OrderStage } from "@/lib/orderStage";
import { personName, type NameByEmail } from "@/lib/personName";
import DeleteOrder from "./DeleteOrder";

/** Фильтр списка: этап заявки, «опаздывают» или все. */
export const STAGE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Все заявки" },
  { value: "open", label: "Открытые" },
  { value: "late", label: "Опаздывают" },
  ...STAGE_ORDER.map((k) => ({ value: k, label: STAGE_LABELS[k] })),
];

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
  today,
  initialFilter = "all",
  canAdmin = false,
}: {
  orders: OrderWithItems[];
  /** Почта → имя из вкладки `Users`. Без неё в колонке стоял бы адрес. */
  managerNames?: NameByEmail;
  /** Сегодня по Алматы — от сервера, чтобы опоздание не зависело от часов телефона. */
  today: string;
  /** Фильтр из адреса (`?stage=late`) — плитки главной ведут сразу в нужный список. */
  initialFilter?: string;
  /** Администратор: «изменить» и «удалить» прямо в строке списка. */
  canAdmin?: boolean;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(
    STAGE_FILTERS.some((f) => f.value === initialFilter) ? initialFilter : "all"
  );
  const [search, setSearch] = useState("");

  // Этап считается один раз на заявку: им пользуются фильтр, сортировка и бейдж.
  const stages = useMemo(() => {
    const m = new Map<string, OrderStage>();
    for (const o of orders) m.set(o.orderId, orderStage(o, today));
    return m;
  }, [orders, today]);
  const stageOf = (o: OrderWithItems) => stages.get(o.orderId)!;

  const filtered = useMemo(() => {
    const list = orders.filter((o) => {
      const st = stages.get(o.orderId)!;
      if (status === "open" && (st.key === "shipped" || st.key === "cancelled")) return false;
      if (status === "late" && st.lateDays <= 0) return false;
      if (status !== "all" && status !== "open" && status !== "late" && st.key !== status) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = `${o.clientName} ${o.managerEmail} ${o.orderId}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // В рабочих отборах — сначала те, что опаздывают сильнее всего.
    return status === "all" ? list : [...list].sort(byUrgency((o: OrderWithItems) => stages.get(o.orderId)!));
  }, [orders, stages, status, search]);

  // Заявок со временем накопится много. Показываем начало списка, остальное по
  // кнопке; при поиске и фильтре по статусу показываем всё найденное — там
  // список человек сузил сам.
  const [expanded, setExpanded] = useState(false);
  const narrowed = status !== "all" || search.trim().length > 0;
  const shown = expanded || narrowed ? filtered : filtered.slice(0, COLLAPSED_TABLE_SIZE);
  const hidden = filtered.length - shown.length;

  const itemText = (i: OrderWithItems["items"][number]) =>
    `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety} ×${i.quantity.toLocaleString("ru-RU")}`;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          id="orders-stage"
          aria-label="Этап заявки"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="input !w-auto"
        >
          {STAGE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          className="input !w-auto flex-1 min-w-[200px]"
          placeholder="Клиент, менеджер или номер"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card !p-0 table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-3 py-3 font-medium">Заявка</th>
              <th className="px-3 py-3 font-medium">Клиент</th>
              <th className="px-3 py-3 font-medium">Менеджер</th>
              <th className="px-3 py-3 font-medium">Позиции</th>
              <th className="px-3 py-3 font-medium text-right">Сумма</th>
              <th className="px-3 py-3 font-medium">Доставка</th>
              <th className="px-3 py-3 font-medium">Этап</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => {
              const stage = stageOf(o);
              return (
                <Fragment key={o.orderId}>
                <tr
                  className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top"
                >
                  <td className="px-3 py-3">
                    {/* Номер не переносится: «ORD-260914-T85ZC» ломался на три
                        строки и в одиночку задирал высоту всей строки. */}
                    <Link
                      href={`/orders/${o.orderId}`}
                      className="text-series-1 font-medium whitespace-nowrap"
                    >
                      {o.orderId}
                    </Link>
                    <div className="text-xs text-ink-muted">{formatDay(o.createdAt)}</div>
                    {/* Действия админа — под номером, а не отдельной колонкой:
                        восьмая колонка вылезала за край (боковой прокрутки в
                        таблицах нет — см. CLAUDE.md). */}
                    {canAdmin && (
                      <div className="mt-1 flex gap-1 text-xs whitespace-nowrap">
                        <Link
                          href={`/orders/${o.orderId}/edit`}
                          className="rounded px-1.5 py-0.5 text-ink-secondary hover:bg-surface-sunk hover:text-accent"
                          title="Изменить заявку"
                        >
                          ✎ изменить
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleting(deleting === o.orderId ? null : o.orderId)}
                          className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-status-critical/10 hover:text-status-critical"
                          title="Удалить заявку"
                        >
                          ✕ удалить
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3" data-label="Клиент">
                    <div className="truncate max-w-[200px]" title={o.clientName}>
                      {o.clientName}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink-secondary" data-label="Менеджер">
                    <div className="truncate max-w-[130px]">
                      {personName(o.managerEmail, managerNames)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink-secondary" data-label="Позиции">
                    <ItemsCell lines={o.items.map(itemText)} />
                  </td>
                  <td className="px-3 py-3 font-medium sm:text-right whitespace-nowrap tabular-nums" data-label="Сумма">
                    {o.totalAmount.toLocaleString("ru-RU")} ₸
                  </td>
                  <td className="px-3 py-3 text-ink-secondary whitespace-nowrap" data-label="Доставка">
                    {formatDay(o.deliveryDate)}
                  </td>
                  {/* Один этап вместо пары «статус + готовность»: раньше у всех
                      строк стояло одинаковое «Новая», а что мешает собрать
                      заявку, было написано мелко под ним и пятью разными
                      словами на разных экранах (`orderStage`). */}
                  <td className="px-3 py-3" data-label="Этап">
                    <OrderStageBadge stage={stage} compact />
                    {stage.actor && (
                      <div className="text-xs text-ink-muted mt-1 whitespace-nowrap">ход: {stage.actor}</div>
                    )}
                  </td>
                </tr>
                {canAdmin && deleting === o.orderId && (
                  <tr className="border-b border-line-hairline">
                    <td colSpan={7} className="px-3 py-3 bg-surface-plane">
                      <DeleteOrder
                        inline
                        orderId={o.orderId}
                        paidAmount={o.paidAmount}
                        shippedStems={o.items.reduce((sum, i) => sum + (i.shippedQuantity || 0), 0)}
                        onClose={() => setDeleting(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
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
