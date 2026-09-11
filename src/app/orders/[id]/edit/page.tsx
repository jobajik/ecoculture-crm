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
import { isRetailOrder, retailLabel, retailTerritoryFor } from "@/lib/retail";
import { ROLES } from "@/lib/constants";
import OrderEditForm from "@/components/OrderEditForm";
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
  if (territory && (!retail || order.retail !== territory)) notFound();
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
    ? "Регион в заявке не меняют: объём двигают именно в этот город, и другой город — это другая заявка. Ошиблись — отмените эту и заведите новую."
    : retail
      ? "Магазин в заявке не меняют: другая точка — это другая заявка. Ошиблись — отмените эту и заведите новую."
      : "Контрагента в заявке не меняют: другой клиент — это другая заявка, с другим счётом и другой историей. Ошиблись в выборе — отмените эту и заведите новую.";

  const lockedSubtitle = region
    ? "Объём уже закрыт — поправить можно только день отгрузки."
    : retail
      ? "Состав заявки уже закрыт — поправить можно только дату доставки."
      : "Состав заявки уже закрыт — поправить можно только дату доставки и комментарий.";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">Изменить заявку {order.orderId}</h1>
        <Link href={`/orders/${order.orderId}`} className="text-sm text-ink-secondary hover:underline">
          ← к заявке
        </Link>
      </div>
      <p className="text-sm text-ink-secondary mb-4">
        {itemsLockReason
          ? lockedSubtitle
          : region
            ? "Можно поправить день отгрузки и объём по сортам. Регион не меняется: это и есть сама заявка."
            : "Можно поправить дату доставки, состав и количество. Клиент не меняется."}
      </p>

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
