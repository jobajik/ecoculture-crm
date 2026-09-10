import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrderById } from "@/lib/repo/orders";
import { listShipments } from "@/lib/repo/shipments";
import { listClaims } from "@/lib/repo/claims";
import { listUsers } from "@/lib/repo/users";
import {
  FLOWER_TYPE_LABELS,
  KASPI_METHOD,
  ROLES,
  farmLabel,
  formatGrade,
  getFarmFor,
} from "@/lib/constants";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import ReadyChecks from "@/components/ReadyChecks";
import OrderClaims, { type OrderClaimRow } from "@/components/OrderClaims";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { isReadyToShip, notReadyReason } from "@/lib/orderReady";
import { cancelRefusal } from "@/lib/orderRules";
import { getClientById } from "@/lib/repo/clients";
import { farmPayments } from "@/lib/orderMoney";
import {
  canFillRegions,
  farmScopeFor,
  isRetailOrder,
  isRetailRole,
  retailLabel,
  retailTerritoryFor,
} from "@/lib/retail";
import CancelOrder from "@/components/CancelOrder";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const loaded = await getOrderById(params.id);
  if (!loaded) notFound();

  const role = session?.user?.role;
  const myEmail = session?.user?.email?.toLowerCase() ?? "";
  // Зав. складом видит только свой цветок — кроме СВОЕЙ заявки в регион: её она
  // составила сама, включая чужой цветок, и прятать от неё собственную заявку
  // было бы просто поломкой (`farmScopeFor`).
  const farm = farmScopeFor({ role, farm: session?.user?.farm, order: loaded, email: myEmail });

  // Розница и продажи наружу разделены и здесь, иначе прямая ссылка обходила бы
  // фильтр списка. Менеджер розницы видит только своё направление; обычный
  // менеджер и бухгалтер розничную заявку не открывают вовсе — им в ней нечего
  // делать, а бухгалтеру ещё и незачем: денег по ней не бывает.
  const territory = retailTerritoryFor(role);
  const retail = isRetailOrder(loaded);
  if (territory && (!retail || loaded.retail !== territory)) notFound();
  if (retail && (role === ROLES.MANAGER || role === ROLES.ACCOUNTANT)) notFound();

  // Зав. складом видит в заявке только свои позиции. Если своего цветка в заявке
  // нет — заявка для неё не существует, чтобы нельзя было открыть её по прямой ссылке.
  const ownItems = farm
    ? loaded.items.filter((i) => getFarmFor(i.flowerType) === farm)
    : loaded.items;
  if (farm && ownItems.length === 0) notFound();

  // Заявка для зав. складом урезается до её позиций, и сумма пересчитывается.
  // Полученные деньги надо урезать в той же пропорции: оплата приходит одной
  // суммой за всю заявку, и оставить её целиком значило бы показать зав.
  // складом Есентая «получено 800 000 из 300 000» — то есть деньги за розы.
  const scopedTotal = ownItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const order = farm
    ? {
        ...loaded,
        items: ownItems,
        totalAmount: scopedTotal,
        paidAmount:
          loaded.totalAmount > 0 ? (loaded.paidAmount * scopedTotal) / loaded.totalAmount : 0,
      }
    : loaded;

  const [allShipments, allClaims, users, client] = await Promise.all([
    listShipments(),
    listClaims(),
    listUsers(),
    loaded.clientId ? getClientById(loaded.clientId) : Promise.resolve(null),
  ]);

  // Счёт по компаниям. Компанию не выбирают руками: роза и эустома идут от Rose
  // Farm, хризантема от Есентая, а в смешанной заявке счетов два, и клиент
  // платит двумя переводами. Считаем по ПОЛНОЙ заявке, а не по урезанной для
  // склада, и зав. складом этот блок не показываем: чужие деньги её не
  // касаются, а свои она видит в сумме своих позиций.
  // По заявке в наш магазин счетов нет вовсе — показывать нечего.
  const invoice = farm || retail ? [] : farmPayments(loaded);
  const kaspiOfClient =
    client && client.paymentMethod === KASPI_METHOD
      ? [client.kaspiPay1, client.kaspiPay2].filter(Boolean)
      : [];
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
  // Отгружает только склад, и только по заявке, которую подтвердил менеджер и
  // провёл бухгалтер. Менеджеру кнопка не нужна вовсе: он не собирает цветок.
  const isWarehouse = role === "warehouse" || role === "admin";
  const openOrder = order.status !== "shipped" && order.status !== "cancelled";
  const ready = isReadyToShip(order);
  const canShip = isWarehouse && openOrder && ready;
  const shipBlockedReason = isWarehouse && openOrder && !ready ? notReadyReason(order) : "";
  // Кнопку отмены показываем только тому, кто действительно может отменить, —
  // правила те же, что проверит сервер (src/lib/orderRules.ts).
  const canCancel = cancelRefusal(order, role, session?.user?.email) === "";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Заявка {order.orderId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-sm text-ink-muted mb-6">
        {retail && (
          <>
            <span className="text-ink-secondary">{retailLabel(order.retail)} · наш магазин</span>
            {" · "}
          </>
        )}
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
        retail={order.retail}
        canConfirm={
          role === "admin" ||
          ((role === "manager" || isRetailRole(role) || (retail && canFillRegions(role))) &&
            order.managerEmail === myEmail)
        }
      />

      <OrderClaims orderId={order.orderId} claims={claims} canCreate={canCreateClaim} />

      {invoice.length > 0 && (
        <div className="card mb-6">
          <div className="text-sm font-medium mb-2">
            {invoice.length > 1 ? "Счета по компаниям" : "Счёт"}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {invoice.map((f) => {
              const left = Math.max(0, f.amount - f.paidAmount);
              return (
                <div key={f.farm}>
                  <div className="label">{f.farmLabel}</div>
                  <div className="font-medium tabular-nums">
                    {Math.round(f.amount).toLocaleString("ru-RU")} ₸
                  </div>
                  <div
                    className={
                      left <= 1
                        ? "text-xs text-status-good"
                        : f.paidAmount > 0
                          ? "text-xs text-[#8a5a00]"
                          : "text-xs text-ink-muted"
                    }
                  >
                    {left <= 1
                      ? "оплачено"
                      : f.paidAmount > 0
                        ? `получено ${Math.round(f.paidAmount).toLocaleString("ru-RU")} ₸ · остаток ${Math.round(left).toLocaleString("ru-RU")} ₸`
                        : "не оплачено"}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-ink-muted mt-2">
            {invoice.length > 1
              ? "В заявке цветок обоих производств — счёта два, и клиент платит двумя переводами. Бухгалтер отмечает каждый отдельно."
              : "Компания определяется по цветку в заявке, выбирать её не нужно."}
            {kaspiOfClient.length > 0 && ` Клиент платит с Kaspi ${kaspiOfClient.join(" / ")}.`}
          </p>
        </div>
      )}

      <div className="card grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <div className="label">Клиент</div>
          <div>
            {order.clientId ? (
              <Link href={`/clients/${order.clientId}`} className="hover:underline">
                {order.clientName}
              </Link>
            ) : (
              order.clientName
            )}
          </div>
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

      {shipBlockedReason && (
        <div className="card mb-6 text-sm text-ink-secondary">
          <span className="font-medium text-ink-primary">Отгрузка пока закрыта.</span>{" "}
          {shipBlockedReason}. Как только обе галочки наверху станут зелёными, здесь появится
          кнопка отгрузки.
        </div>
      )}

      {canCancel && (
        <div className="mb-6">
          <CancelOrder orderId={order.orderId} />
        </div>
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
