import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrderById } from "@/lib/repo/orders";
import { listShipments } from "@/lib/repo/shipments";
import { listClaims } from "@/lib/repo/claims";
import { listUsers } from "@/lib/repo/users";
import { FLOWER_TYPE_LABELS, ROLES, farmLabel, formatGrade, getFarmFor } from "@/lib/constants";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import ReadyChecks from "@/components/ReadyChecks";
import OrderClaims, { type OrderClaimRow } from "@/components/OrderClaims";
import { formatDay, formatMoment } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const loaded = await getOrderById(params.id);
  if (!loaded) notFound();

  const role = session?.user?.role;
  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;

  // Зав. складом видит в заявке только свои позиции. Если своего цветка в заявке
  // нет — заявка для неё не существует, чтобы нельзя было открыть её по прямой ссылке.
  const ownItems = farm
    ? loaded.items.filter((i) => getFarmFor(i.flowerType) === farm)
    : loaded.items;
  if (farm && ownItems.length === 0) notFound();

  const order = farm
    ? {
        ...loaded,
        items: ownItems,
        totalAmount: ownItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
      }
    : loaded;

  const [allShipments, allClaims, users] = await Promise.all([
    listShipments(),
    listClaims(),
    listUsers(),
  ]);
  const shipments = allShipments.filter((s) => s.orderId === order.orderId);

  // Рекламации показываем всем, кто видит заявку: складу тоже полезно знать,
  // что по этой отгрузке была жалоба. Заводить может только свой менеджер.
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const claims: OrderClaimRow[] = allClaims
    .filter((c) => c.orderId === order.orderId)
    .map((c) => ({
      claimId: c.claimId,
      createdAt: c.createdAt,
      reason: c.reason,
      comment: c.comment,
      status: c.status,
      decidedAt: c.decidedAt,
      decision: c.decision,
      managerName: nameByEmail.get(c.managerEmail) ?? c.managerEmail,
    }));
  const canCreateClaim =
    role === ROLES.ADMIN ||
    (role === ROLES.MANAGER && order.managerEmail === session?.user?.email?.toLowerCase());
  const canShip = (role === "warehouse" || role === "admin") && order.status !== "shipped" && order.status !== "cancelled";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Заявка {order.orderId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-sm text-ink-muted mb-6">
        Создана {formatMoment(order.createdAt)} · менеджер {order.managerEmail}
        {farm && (
          <>
            {" · "}
            <span className="text-ink-secondary">
              показаны только позиции {farmLabel(farm)}
            </span>
          </>
        )}
      </p>

      <ReadyChecks
        orderId={order.orderId}
        managerConfirmed={order.managerConfirmed}
        paid={order.paid}
        paidAt={order.paidAt}
        paymentMethod={order.paymentMethod}
        paidAmount={order.paidAmount}
        totalAmount={order.totalAmount}
        canConfirm={
          role === "admin" ||
          (role === "manager" && order.managerEmail === session?.user?.email?.toLowerCase())
        }
      />

      <OrderClaims orderId={order.orderId} claims={claims} canCreate={canCreateClaim} />

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
          <div>{formatDay(order.deliveryDate)}</div>
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
                <td className="px-4 py-3">{formatMoment(s.createdAt)}</td>
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
