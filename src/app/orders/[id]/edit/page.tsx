import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrderById } from "@/lib/repo/orders";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { getStockSnapshot } from "@/lib/stock";
import { PRICE_KINDS, priceMapForClient } from "@/lib/priceList";
import { editHeaderRefusal, editItemsRefusal } from "@/lib/orderEdit";
import { isRegionOrder } from "@/lib/orderKind";
import { isOwnClientOrder, isRetailOrder, retailLabel, retailTerritoryFor } from "@/lib/retail";
import { ROLES } from "@/lib/constants";
import OrderEditForm from "@/components/OrderEditForm";
import PageHeader from "@/components/PageHeader";
import type { DraftItem } from "@/components/OrderItemsEditor";
import type { FlowerType } from "@/lib/constants";

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

  // Те же границы видимости, что и на странице заявки: прямая ссылка не должна
  // обходить разделение направлений розницы (грабли 1.1-ter).
  const territory = retailTerritoryFor(role);
  const retail = isRetailOrder(order);
  const region = isRegionOrder(order);
  if (territory && !isOwnClientOrder(order, email) && (!retail || order.retail !== territory)) {
    notFound();
  }
  if (retail && (role === ROLES.MANAGER || role === ROLES.ACCOUNTANT)) notFound();

  const refusal = editHeaderRefusal(order, role, email);
  if (refusal) redirect(`/orders/${order.orderId}`);

  const itemsLockReason = editItemsRefusal(order, role, email);

  // Прайс нужен, только если цена в заявке есть. У розницы он ВНУТРЕННИЙ:
  // подставить сюда клиентский было бы прямой ошибкой в цифрах.
  const [varieties, prices] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(undefined, retail ? PRICE_KINDS.RETAIL : PRICE_KINDS.CLIENT),
  ]);

  // Остаток склада — подсказка у количества, и нужна она там же, где при
  // создании заявки в магазин: человек перекладывает цветок, а не продаёт.
  let stock: Record<string, number> | undefined;
  if (retail) {
    const snapshot = await getStockSnapshot();
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
        title={`Изменить заявку ${order.orderId}`}
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
      />
    </div>
  );
}
