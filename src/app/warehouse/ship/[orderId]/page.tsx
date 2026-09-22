import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { farmLabel, getFarmFor } from "@/lib/constants";
import { getOrderById } from "@/lib/repo/orders";
import { availableBatchesFor, listBatches } from "@/lib/repo/batches";
import ShipmentForm from "@/components/ShipmentForm";
import Hint from "@/components/Hint";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { formatDay } from "@/lib/formatDate";
import { creditNote, isReadyToShip, notReadyReason } from "@/lib/orderReady";

export const dynamic = "force-dynamic";

export default async function ShipOrderPage({ params }: { params: { orderId: string } }) {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const order = await getOrderById(params.orderId);
  if (!order) notFound();

  // Зав. складом отгружает только позиции своего производства.
  const ownItems = order.items.filter((i) => !farm || getFarmFor(i.flowerType) === farm);

  // Склад читается ОДИН раз на всю страницу, а не по разу на позицию: заявка
  // из восьми позиций стоила восьми чтений, и вместе с отгрузками это упиралось
  // в лимит Google (см. `readTable` в src/lib/sheets.ts).
  const allBatches = await listBatches();
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
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Отгрузка {order.orderId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-ink-secondary mb-6">
        {farm && <>{farmLabel(farm)} · </>}
        {order.clientName}
        {order.deliveryDate && ` · доставка ${formatDay(order.deliveryDate)}`}
      </p>
      {isReadyToShip(order) && creditNote(order) && (
        <p className="text-sm text-[#8a5a00] bg-[#8a5a00]/10 rounded-lg px-3 py-2 mb-4">
          Отгрузка в долг: у клиента «{order.clientPaymentTerms}».
        </p>
      )}
      {isReadyToShip(order) ? (
        <ShipmentForm order={order} itemsWithBatches={itemsWithBatches} />
      ) : (
        <div className="card space-y-2">
          <h2 className="font-medium">
            Отгружать рано
            <Hint>
              Нужны галочка менеджера и оплата. Без оплаты — только клиенту с условиями «По
              факту» или «Отсрочка».
            </Hint>
          </h2>
          <p className="text-sm text-ink-secondary">{notReadyReason(order)}</p>
          <Link href={`/orders/${order.orderId}`} className="btn-secondary inline-flex !py-1.5">
            Открыть заявку
          </Link>
        </div>
      )}
    </div>
  );
}
