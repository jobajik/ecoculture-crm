import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FLOWER_TYPE_LABELS, farmLabel, formatGrade, getFarmFor } from "@/lib/constants";
import { getOrderById } from "@/lib/repo/orders";
import { availableBatchesFor, listBatches } from "@/lib/repo/batches";
import ShipmentForm from "@/components/ShipmentForm";
import Hint from "@/components/Hint";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import OrderStageBadge from "@/components/OrderStageBadge";
import WholeOrderShip from "@/components/WholeOrderShip";
import { orderStage } from "@/lib/orderStage";
import { planWholeOrderShipment } from "@/lib/shipRules";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { canShipUnpaid, creditNote, isReadyToShip, notReadyReason, unpaidRest } from "@/lib/orderReady";
import UnpaidShipGate from "@/components/UnpaidShipGate";
import { inStore, isOfficeRole, normalizeStore, shipStoreRefusal, storeChangeRefusal } from "@/lib/officeStore";
import OrderStoreSwitch from "@/components/OrderStoreSwitch";
import ConfirmOrderButton from "@/components/ConfirmOrderButton";
import { confirmRefusal } from "@/lib/orderRules";
import { orderCode } from "@/lib/paymentStage";

export const dynamic = "force-dynamic";

export default async function ShipOrderPage({ params }: { params: { orderId: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;

  const order = await getOrderById(params.orderId);
  if (!order) notFound();
  // Заявку офиса отгружает склад офиса, основную — основной склад (`officeStore.ts`).
  const storeRefusal = shipStoreRefusal(role, order.store);
  const store = normalizeStore(order.store);
  const office = store === "office";

  // Зав. складом отгружает только позиции своего производства.
  const ownItems = order.items.filter((i) => !farm || getFarmFor(i.flowerType) === farm);

  // Склад читается ОДИН раз на всю страницу, а не по разу на позицию: заявка
  // из восьми позиций стоила восьми чтений, и вместе с отгрузками это упиралось
  // в лимит Google (см. `readTable` в src/lib/sheets.ts).
  const allBatches = inStore(await listBatches(), store);
  // Раскладка «всей заявки сразу» — та же функция, что пересчитает её на сервере.
  const whole = planWholeOrderShipment(ownItems, allBatches);
  const batchById = new Map(allBatches.map((b) => [b.batchId, b]));
  const itemsWithBatches = ownItems.map((item) => ({
    itemId: item.itemId,
    flowerType: item.flowerType,
    variety: item.variety,
    grade: item.grade,
    quantity: item.quantity,
    shippedQuantity: item.shippedQuantity,
    availableBatches: availableBatchesFor(allBatches, item.flowerType, item.variety, item.grade),
  }));
  // Куда вернуться после отгрузки: склад офиса — к своей очереди.
  const backHref = office || isOfficeRole(role) ? "/office/ship" : "/warehouse";
  // Своё отгружено целиком: после «Отгрузить» страница перерисовывается, и вместо
  // формы должен стоять понятный итог с дорогой обратно, а не «Отгружать рано».
  const ownShipped =
    order.status === "shipped" ||
    (ownItems.length > 0 && ownItems.every((i) => i.shippedQuantity >= i.quantity));
  // Ручной выбор партий нужен, когда программе не хватило склада, — иначе он свёрнут.
  const manualOpen = whole.shortages.length > 0 || whole.total === 0;

  // Раскладка «всей заявки» и ручной выбор партий — одни и те же для готовой заявки и для
  // отгрузки без полной оплаты (там — после отметки, `UnpaidShipGate`).
  const shipBlock = (unpaidAck: boolean) => (
    <>
      <WholeOrderShip
        orderId={order.orderId}
        backHref={backHref}
        unpaidAck={unpaidAck}
        total={whole.total}
        lines={whole.lines.map((l) => {
          const item = ownItems.find((i) => i.itemId === l.itemId)!;
          return {
            label: `${item.variety} ${formatGrade(item.grade)}`,
            quantity: l.parts.reduce((sum, p) => sum + p.quantity, 0),
            from: Array.from(new Set(l.parts.map((p) => batchById.get(p.batchId)?.harvestDate ?? ""))).filter(Boolean),
          };
        })}
        shortages={whole.shortages.map((s) => {
          const item = ownItems.find((i) => i.itemId === s.itemId)!;
          return { label: `${item.variety} ${formatGrade(item.grade)}`, missing: s.missing };
        })}
      />
      <details open={manualOpen} className="group">
        <summary className="cursor-pointer select-none text-sm font-semibold text-section-stock mb-3 hover:underline">
          Выбрать партии вручную
        </summary>
        <ShipmentForm order={order} itemsWithBatches={itemsWithBatches} backHref={backHref} unpaidAck={unpaidAck} />
      </details>
    </>
  );

  const shippedNow = ownItems.reduce((s, i) => s + i.shippedQuantity, 0);
  const orderedNow = ownItems.reduce((s, i) => s + i.quantity, 0);

  // Что отгружать — слева, сама заявка — справа (новый вид, 19.10.2026): раньше блоки шли лентой, и до кнопки
  // «Отгрузить всё» на большой заявке надо было листать. На телефоне заявка короткой карточкой сверху.
  const main = storeRefusal ? (
    <Section tone="warn" icon="alert" title="Не ваш склад" className="!mb-0">
      <p className="text-sm text-ink-secondary">{storeRefusal}.</p>
    </Section>
  ) : ownShipped && order.status !== "cancelled" ? (
    <Section tone="good" icon="check" title="Отгружено" className="!mb-0">
      <p className="text-sm text-ink-secondary mb-3">{shippedNow.toLocaleString("ru-RU")} шт. — всё по заявке.</p>
      <Link href={backHref} className="btn-primary inline-flex w-full sm:w-auto justify-center">
        ← К очереди
      </Link>
    </Section>
  ) : isReadyToShip(order) ? (
    shipBlock(false)
  ) : canShipUnpaid(order) ? (
    <UnpaidShipGate rest={unpaidRest(order)}>{shipBlock(true)}</UnpaidShipGate>
  ) : (
    <Section
      tone="warn"
      icon="clock"
      className="!mb-0"
      title={
        <>
          Отгружать рано
          <span className="normal-case tracking-normal">
            <Hint>
              Нужны галочка менеджера и оплата. Без оплаты — только клиенту с условиями «По
              факту» или «Отсрочка».
            </Hint>
          </span>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-secondary">{notReadyReason(order)}</p>
        <div className="flex flex-wrap gap-2">
          {!order.managerConfirmed && confirmRefusal(order, role, session?.user?.email?.toLowerCase() ?? "", true) === "" && (
            <ConfirmOrderButton orderId={order.orderId} />
          )}
          {role !== "office" && (
            <Link href={`/orders/${order.orderId}`} className="btn-secondary inline-flex !py-1.5">
              Открыть заявку
            </Link>
          )}
        </div>
      </div>
    </Section>
  );

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Отгрузка № ${orderCode(order.orderId)}`}
        icon="truck"
        subtitle={
          <>
            {office && <>Офис · </>}
            {farm && <>{farmLabel(farm)} · </>}
            {order.clientName}
          </>
        }
        actions={
          <Link href={backHref} className="btn-secondary">
            ← К очереди
          </Link>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <aside className="space-y-4 xl:order-2 xl:sticky xl:top-4">
          <div className="card !p-0 overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-line-hairline">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display font-bold text-[17px] truncate" title={order.clientName}>
                    {order.clientName || "—"}
                  </div>
                  <div className="text-[11px] text-ink-muted font-mono">№ {orderCode(order.orderId)}</div>
                </div>
                <OrderStageBadge stage={orderStage(order, localDayKey())} compact />
              </div>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-ink-muted">Доставка</dt>
                <dd className="text-right font-medium">{order.deliveryDate ? formatDay(order.deliveryDate) : "без даты"}</dd>
                {order.clientPhone && (
                  <>
                    <dt className="text-ink-muted">Телефон</dt>
                    <dd className="text-right">
                      <a href={`tel:${order.clientPhone}`} className="font-medium hover:text-section-stock">
                        {order.clientPhone}
                      </a>
                    </dd>
                  </>
                )}
                <dt className="text-ink-muted">Склад</dt>
                <dd className="text-right">{office ? "Офис" : "Основной"}</dd>
              </dl>
              {order.notes && (
                <p className="mt-3 text-sm text-ink-secondary bg-surface-plane rounded-lg px-3 py-2">{order.notes}</p>
              )}
              {!storeRefusal && isReadyToShip(order) && creditNote(order) && (
                <p className="mt-3 text-sm text-[#8a5a00] bg-[#8a5a00]/10 rounded-lg px-3 py-2">
                  Отгрузка в долг: у клиента «{order.clientPaymentTerms}».
                </p>
              )}
            </div>
            <div className="px-4 sm:px-5 py-3">
              <div className="flex items-baseline justify-between text-xs text-ink-muted mb-2">
                <span>Позиции{farm ? " вашего цветка" : ""}</span>
                <span className="tabular-nums">
                  {shippedNow.toLocaleString("ru-RU")} / {orderedNow.toLocaleString("ru-RU")} шт.
                </span>
              </div>
              <ul className="space-y-2">
                {ownItems.map((i) => {
                  const pct = i.quantity > 0 ? Math.min(100, Math.round((i.shippedQuantity / i.quantity) * 100)) : 0;
                  return (
                    <li key={i.itemId} className="text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {FLOWER_TYPE_LABELS[i.flowerType] ?? ""} {i.variety} · {formatGrade(i.grade)}
                        </span>
                        <span className="tabular-nums whitespace-nowrap text-ink-secondary">
                          {i.shippedQuantity.toLocaleString("ru-RU")}/{i.quantity.toLocaleString("ru-RU")}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-surface-sunk mt-1 overflow-hidden">
                        <div className={pct >= 100 ? "h-full bg-status-good" : "h-full bg-section-stock"} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          {isOfficeRole(role) && office && (
            <div className="card text-sm">
              <OrderStoreSwitch
                orderId={order.orderId}
                store={order.store}
                editable={storeChangeRefusal({ role, isOwner: false, order, to: "" }) === ""}
              />
              <p className="text-xs text-ink-muted mt-1">Не хватает в офисе — отдайте заявку на основной склад.</p>
            </div>
          )}
        </aside>

        <div className="min-w-0 xl:order-1">{main}</div>
      </div>
    </div>
  );
}
