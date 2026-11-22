import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrderById } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { getStockSnapshot } from "@/lib/stock";
import { PRICE_KINDS, priceMapForClient } from "@/lib/priceList";
import { editHeaderRefusal, editItemsRefusal } from "@/lib/orderEdit";
import { isRegionOrder } from "@/lib/orderKind";
import { isOwnClientOrder, isRetailOrder, retailLabel, retailTerritoryFor } from "@/lib/retail";
import { FLOWER_TYPE_LABELS, MONEY_EPSILON, ROLES, formatGrade } from "@/lib/constants";
import { isRfShipment, rfEditRefusal } from "@/lib/rfEdit";
import { hasRubPrices, rubComment } from "@/lib/rubShipment";
import { rubFormBatches, rubFormClients } from "@/lib/rubFormData";
import { listBatches } from "@/lib/repo/batches";
import { localDayKey } from "@/lib/timezone";
import RfShipmentEditForm from "@/components/RfShipmentEditForm";
import OrderEditForm from "@/components/OrderEditForm";
import PageHeader from "@/components/PageHeader";
import { orderCode } from "@/lib/paymentStage";
import type { DraftItem } from "@/components/OrderItemsEditor";
import type { FlowerType } from "@/lib/constants";
import { orderOutOfScope } from "@/lib/repo/cityScopeGate";

export const dynamic = "force-dynamic";

/**
 * Правка заявки. Открывается только тому, кто её составил (и администратору),
 * и только пока заявку вообще можно трогать.
 *
 * Проверка стоит здесь же, а не только в серверном действии, по простой
 * причине: человек не должен заполнять форму, чтобы узнать, что сохранить её
 * нельзя. Запрет при этом всё равно живёт на сервере — страница лишь не водит
 * за нос.
 */
export default async function EditOrderPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const email = session?.user?.email?.toLowerCase() ?? "";

  const order = await getOrderById(params.id);
  if (!order) notFound();
  // Менеджер города чужую заявку не открывает и по прямой ссылке (`cityScope.ts`).
  if (await orderOutOfScope(order, session?.user)) notFound();

  // Те же границы видимости, что и на странице заявки: прямая ссылка не должна
  // обходить разделение направлений розницы (грабли 1.1-ter).
  const territory = retailTerritoryFor(role);
  const retail = isRetailOrder(order);
  const region = isRegionOrder(order);
  if (territory && !isOwnClientOrder(order, email) && (!retail || order.retail !== territory)) {
    notFound();
  }
  if (retail && (role === ROLES.MANAGER || role === ROLES.ACCOUNTANT)) notFound();

  // Отгрузка в РФ правится своей формой (`rfEdit.ts`): рублёвые цены, количество с возвратом на склад, отмена. Обычная
  // форма про рубли не знает, а отгруженную заявку открывает только администратору.
  if (isRfShipment(order)) {
    const farm = role === ROLES.WAREHOUSE ? session?.user?.farm ?? "" : "";
    if (rfEditRefusal(order, role, role === ROLES.WAREHOUSE ? farm : null)) redirect(`/orders/${order.orderId}`);
    const [allClients, allBatches] = await Promise.all([listClients(), listBatches()]);
    const priced = hasRubPrices(order);
    return (
      <div>
        <PageHeader
          area="orders"
          title={`Изменить отгрузку в РФ №${orderCode(order.orderId)}`}
          subtitle={priced ? undefined : "Цены в рублях и клиент ещё не указаны — их можно дописать здесь."}
          actions={
            <Link href={`/orders/${order.orderId}`} className="text-sm text-ink-secondary hover:underline">
              ← к заявке
            </Link>
          }
        />
        <RfShipmentEditForm
          orderId={order.orderId}
          clients={rubFormClients(allClients, order.clientId)}
          batches={rubFormBatches(allBatches, farm)}
          items={order.items.map((i) => ({
            itemId: i.itemId,
            title: `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety} · ${formatGrade(i.grade)}`,
            quantity: i.quantity,
            shipped: i.shippedQuantity,
            priceRub: i.priceRub ?? 0,
          }))}
          today={localDayKey()}
          initialClientId={order.clientId}
          initialDate={order.deliveryDate}
          initialComment={rubComment(order.notes)}
          hadPrices={priced}
          lockedCancel={
            order.paidAmount > MONEY_EPSILON
              ? "По отгрузке вписаны поступления. Чтобы отменить её, сначала бухгалтер убирает сумму."
              : ""
          }
        />
      </div>
    );
  }

  const refusal = editHeaderRefusal(order, role, email);
  if (refusal) redirect(`/orders/${order.orderId}`);

  const itemsLockReason = editItemsRefusal(order, role, email);

  // Прайс нужен, только если цена в заявке есть. У розницы он ВНУТРЕННИЙ:
  // подставить сюда клиентский было бы прямой ошибкой в цифрах.
  const admin = role === ROLES.ADMIN;
  const [varieties, prices, clients] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(undefined, retail ? PRICE_KINDS.RETAIL : PRICE_KINDS.CLIENT),
    // Клиента меняет только администратор, и не у объёма на город (там клиента нет).
    admin && !region ? listClients() : Promise.resolve([]),
  ]);
  const clientOptions =
    admin && !region
      ? clients
          .filter((c) => (c.active || c.clientId === order.clientId) && !!(c.retail || "").trim() === retail)
          .map((c) => ({ clientId: c.clientId, name: c.name, city: c.city }))
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      : undefined;
  const shipped = order.items.reduce((sum, i) => sum + i.shippedQuantity, 0);
  const adminNote = admin
    ? [
        order.paidAmount > 0 ? "Оплата уже внесена — долг и отметка «оплачено» пересчитаются от новой суммы." : "",
        shipped > 0 ? "Часть уже отгружена — уменьшить позицию ниже отгруженного нельзя." : "",
        shipped === 0 && order.managerConfirmed ? "Правка позиций снимет подтверждение." : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  // Остаток склада — подсказка у количества, и нужна она там же, где при
  // создании заявки в магазин: человек перекладывает цветок, а не продаёт.
  let stock: Record<string, number> | undefined;
  if (retail) {
    const snapshot = await getStockSnapshot(new Date(), undefined, null, { store: "" });
    stock = {};
    for (const card of snapshot.varieties) {
      for (const grade of card.grades) {
        stock[`${card.flowerType}|${card.variety}|${grade.grade}`] = grade.quantity;
      }
    }
  }

  const initialItems: DraftItem[] = order.items.map((item) => ({
    itemId: item.itemId,
    flowerType: item.flowerType as FlowerType,
    variety: item.variety,
    grade: item.grade,
    quantity: String(item.quantity),
    unitPrice: item.unitPrice > 0 ? String(item.unitPrice) : "",
  }));

  const clientLabel = region
    ? order.direction || "направление не указано"
    : retail
      ? `${order.clientName} · наш магазин (${retailLabel(order.retail)})`
      : order.clientName;

  // Слова у трёх видов заявок разные, и подставлять клиентские городской — это
  // рассказывать человеку про счёт, которого у него нет.
  const clientHint = region
    ? "Регион не меняется. Ошиблись — отмените и заведите новую."
    : admin
      ? "Администратор может передать заявку другому клиенту (магазин — только другому нашему магазину)."
      : retail
      ? "Магазин не меняется. Ошиблись — отмените и заведите новую."
      : "Клиент не меняется. Ошиблись — отмените и заведите новую.";

  const lockedSubtitle = region
    ? "Объём закрыт — можно поменять только день отгрузки."
    : retail
      ? "Состав закрыт — можно поменять только дату."
      : "Состав закрыт — можно поменять только дату и комментарий.";

  return (
    <div>
      <PageHeader
        area="orders"
        title={`Изменить заявку №${orderCode(order.orderId)}`}
        subtitle={itemsLockReason ? lockedSubtitle : undefined}
        actions={
          <Link href={`/orders/${order.orderId}`} className="text-sm text-ink-secondary hover:underline">
            ← к заявке
          </Link>
        }
      />

      <OrderEditForm
        orderId={order.orderId}
        varieties={varieties}
        prices={region ? {} : priceMapForClient(prices)}
        stock={stock}
        initialDeliveryDate={order.deliveryDate}
        initialPhone={order.clientPhone}
        initialNotes={order.notes}
        initialItems={initialItems}
        showContacts={!region && !retail}
        showPrice={!region}
        itemsLockReason={itemsLockReason}
        wasConfirmed={order.managerConfirmed}
        clientLabel={clientLabel}
        clientHint={clientHint}
        dateLabel={region ? "Дата отгрузки" : "Дата доставки"}
        counterpartyLabel={region ? "Куда" : "Кому"}
        clientOptions={clientOptions}
        initialClientId={order.clientId}
        adminNote={adminNote}
      />
    </div>
  );
}
