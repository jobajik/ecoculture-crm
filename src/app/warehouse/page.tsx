import Link from "next/link";
import ItemsCell from "@/components/ItemsCell";
import ShipQueueTable from "@/components/ShipQueueTable";
import { orderCode } from "@/lib/paymentStage";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import OrderStageBadge from "@/components/OrderStageBadge";
import { byUrgency, orderStage } from "@/lib/orderStage";
import { localDayKey } from "@/lib/timezone";
import { FLOWER_TYPE_LABELS, farmLabel, getFarmFor } from "@/lib/constants";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import { WAREHOUSE_TABS } from "./tabs";
import { formatDay } from "@/lib/formatDate";
import { isReadyToShip } from "@/lib/orderReady";
import { isOffice } from "@/lib/officeStore";

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
  // Заявки офиса собирает склад офиса — здесь их нет (`officeStore.ts`).
  const scoped = orders
    .filter((o) => !isOffice(o))
    .map((o) => ({
      ...o,
      items: farm ? o.items.filter((i) => getFarmFor(i.flowerType) === farm) : o.items,
    }))
    .filter((o) => o.items.length > 0);

  // В очереди — то, что ещё есть отгружать СВОИМ цветком: заявка, по которой
  // своё уже уехало целиком, здесь только мешает (раньше она висела с кнопкой
  // «Отгрузить» при 600/600). Сначала опоздавшие — давние выше, дальше по дню
  // доставки (`byUrgency`): по живой базе 63 % отгрузок отмечались уже после
  // дня доставки, и главная причина — прошлые заявки терялись среди будущих.
  const today = localDayKey();
  const stageOf = (o: (typeof scoped)[number]) => orderStage(o, today);
  const pending = scoped
    .filter((o) => {
      const k = stageOf(o).key;
      return k !== "shipped" && k !== "cancelled";
    })
    .sort(byUrgency(stageOf));
  const lateCount = pending.filter((o) => isReadyToShip(o) && stageOf(o).lateDays > 0).length;

  const readyToShip = pending.filter((o) => isReadyToShip(o));
  const waiting = pending.filter((o) => !isReadyToShip(o));

  const alerts = batches
    .filter((b) => b.quantityRemaining > 0 && !b.store)
    .filter((b) => !farm || getFarmFor(b.flowerType) === farm)
    .map((b) => computeBatchStorageInfo(b, settings))
    .filter((s) => s.status === "warning" || s.status === "critical")
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        area="stock"
        title="Очередь на отгрузку"
        subtitle={farm ? `Производство: ${farmLabel(farm)}` : undefined}
        icon="truck"
        tabs={WAREHOUSE_TABS}
        actions={
          <div className="flex gap-2">
            <Link href="/orders/new?region=1" className="btn-secondary">
              + Опт в регион
            </Link>
            <Link href="/warehouse/receive" className="btn-primary">
              + Приёмка
            </Link>
          </div>
        }
      />

      {alerts.length > 0 && (
        <Section tone="warn" icon="alert" title="Срок хранения">
          <ul className="text-sm space-y-1">
            {alerts.map((a) => (
              <li key={a.batch.batchId} className="flex justify-between gap-3 text-ink-secondary">
                <span className="min-w-0 truncate">
                  {FLOWER_TYPE_LABELS[a.batch.flowerType]} {a.batch.variety} — {a.batch.quantityRemaining.toLocaleString("ru-RU")} шт.
                </span>
                <span
                  className={
                    "shrink-0 whitespace-nowrap font-medium " +
                    (a.status === "critical" ? "text-status-critical" : "text-[#8a5a00]")
                  }
                >
                  {a.daysInStorage} дн.{a.daysInStorage >= a.maxDays ? ` · срок ${a.maxDays}` : ` из ${a.maxDays}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm">
            <Link href="/warehouse/batches" className="text-series-1">
              Все партии →
            </Link>
            <Link href="/warehouse/writeoff?mode=recount" className="text-series-1">
              Сверить остаток →
            </Link>
          </div>
        </Section>
      )}

      <Section
        tone="stock"
        icon="truck"
        title="Можно отгружать"
        aside={
          lateCount > 0 && (
            <span className="badge bg-status-critical/10 text-status-critical align-middle">
              опаздывают: {lateCount}
            </span>
          )
        }
        flush
      >
        <ShipQueueTable
          orders={readyToShip}
          today={today}
          stageOf={stageOf}
          showPhone={false}
          empty={waiting.length > 0 ? "Готовых заявок нет" : "Отгружать нечего"}
          action={(o) => (
            <Link href={`/warehouse/ship/${o.orderId}`} className="btn-primary !py-1">
              Отгрузить
            </Link>
          )}
        />
      </Section>

      {waiting.length > 0 && (
        <Section tone="neutral" icon="clock" title="Ждут подтверждения или оплаты" flush>
          <div className="table-scroll table-cards border-t border-line-hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
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
                    <td className="px-4 py-3">
                      <Link href={`/orders/${o.orderId}`} className="hover:underline">
                        <div className="font-medium truncate max-w-[220px]" title={o.clientName}>
                          {o.clientName || "—"}
                        </div>
                        <div className="text-[11px] text-ink-muted font-mono font-normal">№ {orderCode(o.orderId)}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary" data-label="Доставка">{formatDay(o.deliveryDate)}</td>
                    <td className="px-4 py-3 text-ink-secondary" data-label="Позиции">
                      <ItemsCell
                        lines={o.items.map((i) => `${i.variety} ${i.shippedQuantity}/${i.quantity}`)}
                        width="max-w-[260px]"
                      />
                    </td>
                    <td className="px-4 py-3" data-label="Чего ждём">
                      <OrderStageBadge stage={stageOf(o)} compact showActor />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
