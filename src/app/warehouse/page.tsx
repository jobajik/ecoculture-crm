import Link from "next/link";
import ItemsCell from "@/components/ItemsCell";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { FLOWER_TYPE_LABELS, farmLabel, getFarmFor } from "@/lib/constants";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import SectionTabs from "@/components/SectionTabs";
import { WAREHOUSE_TABS } from "./tabs";
import { formatDay } from "@/lib/formatDate";
import { creditNote, isReadyToShip, notReadyReason } from "@/lib/orderReady";

export const dynamic = "force-dynamic";

export default async function WarehousePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const [orders, batches, settings] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    getSettings(),
  ]);

  // Зав. складом видит только заявки со своим цветком и только эти позиции.
  const scoped = orders
    .map((o) => ({
      ...o,
      items: farm ? o.items.filter((i) => getFarmFor(i.flowerType) === farm) : o.items,
    }))
    .filter((o) => o.items.length > 0);

  const pending = scoped
    .filter((o) => o.status === "new" || o.status === "in_progress" || o.status === "ready")
    .sort((a, b) => {
      const da = a.deliveryDate || "9999-12-31";
      const db = b.deliveryDate || "9999-12-31";
      return da < db ? -1 : da > db ? 1 : 0;
    });

  // Заявку видно в обоих случаях — зав. складом должна знать, что готовится.
  // Но собирать и выдавать можно только ту, где менеджер подтвердил и
  // бухгалтер провёл оплату. Поэтому два списка, а не одна кнопка с отказом.
  const readyToShip = pending.filter((o) => isReadyToShip(o));
  const waiting = pending.filter((o) => !isReadyToShip(o));

  const alerts = batches
    .filter((b) => b.quantityRemaining > 0)
    .filter((b) => !farm || getFarmFor(b.flowerType) === farm)
    .map((b) => computeBatchStorageInfo(b, settings))
    .filter((s) => s.status === "warning" || s.status === "critical")
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .slice(0, 5);

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-semibold">Склад</h1>
        {farm && <p className="text-sm text-ink-secondary">Производство: {farmLabel(farm)}</p>}
      </div>

      <div className="mb-4">
        <SectionTabs tabs={WAREHOUSE_TABS} />
      </div>

      <div className="flex items-center justify-end mb-4 flex-wrap gap-2">
        <div className="flex gap-2">
          <Link href="/orders/new?region=1" className="btn-secondary">
            + Опт в регион
          </Link>
          <Link href="/warehouse/receive" className="btn-primary">
            + Приёмка
          </Link>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card mb-6 border-status-warning/40">
          <h2 className="font-medium mb-2">⚠ Истекает срок хранения</h2>
          <ul className="text-sm space-y-1">
            {alerts.map((a) => (
              <li key={a.batch.batchId} className="flex justify-between text-ink-secondary">
                <span>
                  {FLOWER_TYPE_LABELS[a.batch.flowerType]} {a.batch.variety} — {a.batch.quantityRemaining} шт.
                </span>
                <span className={a.status === "critical" ? "text-status-critical font-medium" : "text-[#8a5a00] font-medium"}>
                  {a.daysInStorage} из {a.maxDays} дней
                </span>
              </li>
            ))}
          </ul>
          <Link href="/warehouse/batches" className="text-sm text-series-1 mt-2 inline-block">
            Все партии →
          </Link>
        </div>
      )}

      <h2 className="font-medium mb-2">Можно отгружать</h2>
      <div className="card !p-0 table-scroll table-cards mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Заявка</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Доставка</th>
              <th className="px-4 py-3 font-medium">Позиции</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {readyToShip.map((o) => (
              <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top">
                <td className="px-4 py-3 font-medium">{o.orderId}</td>
                <td className="px-4 py-3" data-label="Клиент">
                  <div className="truncate max-w-[200px]" title={o.clientName}>
                    {o.clientName}
                  </div>
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
                <td className="px-4 py-3">
                  <OrderStatusBadge status={o.status} />
                  {creditNote(o) && (
                    <div className="text-xs text-[#8a5a00] mt-1 whitespace-nowrap">{creditNote(o)}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/warehouse/ship/${o.orderId}`} className="btn-primary !py-1">
                    Отгрузить
                  </Link>
                </td>
              </tr>
            ))}
            {readyToShip.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-muted">
                  {waiting.length > 0 ? "Готовых заявок нет" : "Отгружать нечего"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {waiting.length > 0 && (
        <>
          <h2 className="font-medium mb-2">Ждут подтверждения</h2>
          <div className="card !p-0 table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-3 font-medium">Заявка</th>
                  <th className="px-4 py-3 font-medium">Клиент</th>
                  <th className="px-4 py-3 font-medium">Доставка</th>
                  <th className="px-4 py-3 font-medium">Позиции</th>
                  <th className="px-4 py-3 font-medium">Чего ждём</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((o) => (
                  <tr
                    key={o.orderId}
                    className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top"
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      <Link href={`/orders/${o.orderId}`} className="hover:underline">
                        {o.orderId}
                      </Link>
                    </td>
                    <td className="px-4 py-3" data-label="Клиент">
                      <div className="truncate max-w-[200px]" title={o.clientName}>
                        {o.clientName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary" data-label="Доставка">{formatDay(o.deliveryDate)}</td>
                    <td className="px-4 py-3 text-ink-secondary" data-label="Позиции">
                      <ItemsCell
                        lines={o.items.map((i) => `${i.variety} ${i.shippedQuantity}/${i.quantity}`)}
                        width="max-w-[260px]"
                      />
                    </td>
                    <td className="px-4 py-3 text-[#8a5a00]" data-label="Чего ждём">
                      <div className="truncate max-w-[210px]" title={notReadyReason(o)}>
                        {notReadyReason(o)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
