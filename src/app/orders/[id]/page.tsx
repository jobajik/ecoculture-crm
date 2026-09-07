import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrderById } from "@/lib/repo/orders";
import { listShipments } from "@/lib/repo/shipments";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import ReadyChecks from "@/components/ReadyChecks";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const order = await getOrderById(params.id);
  if (!order) notFound();

  const allShipments = await listShipments();
  const shipments = allShipments.filter((s) => s.orderId === order.orderId);
  const role = session?.user?.role;
  const canShip = (role === "warehouse" || role === "admin") && order.status !== "shipped" && order.status !== "cancelled";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Заявка {order.orderId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-sm text-ink-muted mb-6">
        Создана {new Date(order.createdAt).toLocaleString("ru-RU")} · менеджер {order.managerEmail}
      </p>

      <ReadyChecks
        orderId={order.orderId}
        managerConfirmed={order.managerConfirmed}
        paid={order.paid}
        paidAt={order.paidAt}
        paymentMethod={order.paymentMethod}
        canConfirm={
          role === "admin" ||
          (role === "manager" && order.managerEmail === session?.user?.email?.toLowerCase())
        }
      />

      <div className="card grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <div className="label">Клиент</div>
          <div>{order.clientName}</div>
        </div>
        <div>
          <div className="label">Телефон</div>
          <div>{order.clientPhone || "—"}</div>
        </div>
        <div>
          <div className="label">Дата доставки</div>
          <div>{order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString("ru-RU") : "—"}</div>
        </div>
        <div>
          <div className="label">Комментарий</div>
          <div>{order.notes || "—"}</div>
        </div>
      </div>

      <div className="card !p-0 overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Тип</th>
              <th className="px-4 py-3 font-medium">Сорт</th>
              <th className="px-4 py-3 font-medium">Длина / категория</th>
              <th className="px-4 py-3 font-medium">Заказано</th>
              <th className="px-4 py-3 font-medium">Отгружено</th>
              <th className="px-4 py-3 font-medium">Цена</th>
              <th className="px-4 py-3 font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.itemId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-3">{FLOWER_TYPE_LABELS[item.flowerType]}</td>
                <td className="px-4 py-3">{item.variety}</td>
                <td className="px-4 py-3">{formatGrade(item.grade)}</td>
                <td className="px-4 py-3">{item.quantity}</td>
                <td className="px-4 py-3">
                  {item.shippedQuantity} / {item.quantity}
                </td>
                <td className="px-4 py-3">{item.unitPrice.toLocaleString("ru-RU")} ₸</td>
                <td className="px-4 py-3 font-medium">
                  {(item.quantity * item.unitPrice).toLocaleString("ru-RU")} ₸
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="px-4 py-3 text-right text-ink-secondary">
                Итого
              </td>
              <td className="px-4 py-3 font-semibold">{order.totalAmount.toLocaleString("ru-RU")} ₸</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {canShip && (
        <Link href={`/warehouse/ship/${order.orderId}`} className="btn-primary mb-6 inline-flex">
          Отгрузить по этой заявке
        </Link>
      )}

      <h2 className="font-medium mb-2">История отгрузок</h2>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Партия</th>
              <th className="px-4 py-3 font-medium">Кол-во</th>
              <th className="px-4 py-3 font-medium">Кладовщик</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.shipmentId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-3">{new Date(s.createdAt).toLocaleString("ru-RU")}</td>
                <td className="px-4 py-3">{s.batchId}</td>
                <td className="px-4 py-3">{s.quantity}</td>
                <td className="px-4 py-3 text-ink-secondary">{s.warehouseEmail}</td>
              </tr>
            ))}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  Отгрузок ещё не было
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
