import type { ReactNode } from "react";
import clsx from "clsx";
import ItemsCell from "@/components/ItemsCell";
import OrderStageBadge from "@/components/OrderStageBadge";
import type { OrderStage } from "@/lib/orderStage";
import { orderCode } from "@/lib/paymentStage";
import { formatDay } from "@/lib/formatDate";
import { creditNote } from "@/lib/orderReady";
import { groupByDelivery } from "@/lib/shipQueue";
import type { OrderWithItems } from "@/lib/types";

/**
 * «Можно отгружать» — одна таблица на склад и офис. Карточка заявки называется
 * клиентом и коротким номером (`orderCode`), а не полным ORD-…: его не читают
 * глазами и не называют по телефону. Список разрезан по дню доставки.
 */
export default function ShipQueueTable({
  orders,
  today,
  stageOf,
  action,
  showPhone = false,
  empty,
}: {
  orders: OrderWithItems[];
  today: string;
  stageOf: (o: OrderWithItems) => OrderStage;
  /** Кнопка в последней колонке. */
  action: (o: OrderWithItems) => ReactNode;
  /** Телефон клиента под именем (офис: клиенту звонят про такси). */
  showPhone?: boolean;
  empty: string;
}) {
  const groups = groupByDelivery(orders, today);
  return (
    <div className="table-scroll table-cards border-t border-line-hairline">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-secondary border-b border-line-hairline">
            <th className="px-4 py-3 font-medium">Клиент</th>
            <th className="px-4 py-3 font-medium">Доставка</th>
            <th className="px-4 py-3 font-medium">Позиции</th>
            <th className="px-4 py-3 font-medium">Этап</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="bg-surface-plane border-b border-line-hairline">
              <td
                colSpan={5}
                className={clsx(
                  "px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.06em]",
                  g.key === "late" ? "text-status-critical" : "text-ink-muted"
                )}
              >
                {g.label} · {g.orders.length}
              </td>
            </tr>
            {g.orders.map((o) => (
              <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top">
                <td className="px-4 py-3">
                  <div className="font-medium truncate max-w-[220px]" title={o.clientName}>
                    {o.clientName || "—"}
                  </div>
                  <div className="text-[11px] text-ink-muted font-mono font-normal">№ {orderCode(o.orderId)}</div>
                  {showPhone && o.clientPhone && (
                    <a href={`tel:${o.clientPhone}`} className="block text-xs text-ink-secondary font-normal whitespace-nowrap">
                      {o.clientPhone}
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-secondary" data-label="Доставка">
                  {formatDay(o.deliveryDate)}
                </td>
                <td className="px-4 py-3 text-ink-secondary" data-label="Позиции">
                  <ItemsCell
                    lines={o.items.map((i) => `${i.variety} ${i.shippedQuantity}/${i.quantity}`)}
                    width="max-w-[260px]"
                  />
                </td>
                <td className="px-4 py-3" data-label="Этап">
                  <OrderStageBadge stage={stageOf(o)} compact />
                  {creditNote(o) && (
                    <div className="text-xs text-[#8a5a00] mt-1 whitespace-nowrap">{creditNote(o)}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{action(o)}</td>
              </tr>
            ))}
          </tbody>
        ))}
        {groups.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                {empty}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}
