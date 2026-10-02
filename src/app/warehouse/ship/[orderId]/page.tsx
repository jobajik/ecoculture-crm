import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { farmLabel, formatGrade, getFarmFor } from "@/lib/constants";
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
import { creditNote, isReadyToShip, notReadyReason } from "@/lib/orderReady";
import { inStore, normalizeStore, shipStoreRefusal, storeChangeRefusal } from "@/lib/officeStore";
import OrderStoreSwitch from "@/components/OrderStoreSwitch";

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

  return (
    <div className="max-w-2xl">
      <PageHeader
        area="stock"
        title={`Отгрузка ${order.orderId}`}
        icon="truck"
        subtitle={
          <>
            {office && <>Офис · </>}
            {farm && <>{farmLabel(farm)} · </>}
            {order.clientName}
            {office && order.clientPhone && ` · ${order.clientPhone}`}
            {order.deliveryDate && ` · доставка ${formatDay(order.deliveryDate)}`}
          </>
        }
        actions={<OrderStageBadge stage={orderStage(order, localDayKey())} />}
      />
      {role === "office" && office && (
        <div className="card mb-4 text-sm">
          <OrderStoreSwitch
            orderId={order.orderId}
            store={order.store}
            editable={storeChangeRefusal({ role, isOwner: false, order, to: "" }) === ""}
          />
          <p className="text-xs text-ink-muted mt-1">Не хватает в офисе — отдайте заявку на основной склад.</p>
        </div>
      )}
      {office && order.notes && (
        <p className="text-sm text-ink-secondary bg-surface-plane rounded-lg px-3 py-2 mb-4">{order.notes}</p>
      )}
      {storeRefusal ? (
        <Section tone="warn" icon="alert" title="Не ваш склад">
          <p className="text-sm text-ink-secondary">{storeRefusal}.</p>
        </Section>
      ) : null}
      {!storeRefusal && isReadyToShip(order) && creditNote(order) && (
        <p className="text-sm text-[#8a5a00] bg-[#8a5a00]/10 rounded-lg px-3 py-2 mb-4">
          Отгрузка в долг: у клиента «{order.clientPaymentTerms}».
        </p>
      )}
      {storeRefusal ? null : isReadyToShip(order) ? (
        <>
          <WholeOrderShip
            orderId={order.orderId}
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
          <h2 className="font-medium mb-2">По позициям — выбрать партии самому</h2>
          <ShipmentForm order={order} itemsWithBatches={itemsWithBatches} />
        </>
      ) : (
        <Section
          tone="warn"
          icon="clock"
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
          <div className="space-y-2">
            <p className="text-sm text-ink-secondary">{notReadyReason(order)}</p>
            {role !== "office" && (
              <Link href={`/orders/${order.orderId}`} className="btn-secondary inline-flex !py-1.5">
                Открыть заявку
              </Link>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
