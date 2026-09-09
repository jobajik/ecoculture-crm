import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { farmLabel, getFarmFor } from "@/lib/constants";
import { getOrderById } from "@/lib/repo/orders";
import { listAvailableBatchesFor } from "@/lib/repo/batches";
import ShipmentForm from "@/components/ShipmentForm";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { formatDay } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

export default async function ShipOrderPage({ params }: { params: { orderId: string } }) {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const order = await getOrderById(params.orderId);
  if (!order) notFound();

  // Зав. складом отгружает только позиции своего производства.
  const ownItems = order.items.filter((i) => !farm || getFarmFor(i.flowerType) === farm);

  const itemsWithBatches = await Promise.all(
    ownItems.map(async (item) => ({
      itemId: item.itemId,
      flowerType: item.flowerType,
      variety: item.variety,
      grade: item.grade,
      quantity: item.quantity,
      shippedQuantity: item.shippedQuantity,
      availableBatches: await listAvailableBatchesFor(item.flowerType, item.variety, item.grade),
    }))
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Отгрузка по заявке {order.orderId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-ink-secondary mb-6">
        {farm && <>Производство: {farmLabel(farm)} · </>}
        Клиент: {order.clientName}
        {order.deliveryDate && ` · доставка ${formatDay(order.deliveryDate)}`}
      </p>
      <ShipmentForm order={order} itemsWithBatches={itemsWithBatches} />
    </div>
  );
}
