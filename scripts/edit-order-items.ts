/*
 * Разовая правка позиций заявки по просьбе владельца (снимок экрана, 21.09):
 *   «Камала 50 — 45 убрать, Жумилия 50 — 105 шт изменить, Аваланч 50 — 60 надо добавить».
 *
 * Номера заявки на снимке не было, поэтому заявка ищется ПО СОСТАВУ: доставка
 * 15.09.2026, роза Red Naomi 60, Anna Karina 60, Peach Avalanche 60, Jumilia 45,
 * Kamala 45, Мини-микс пионовидные 320. Если найдена не ровно одна — скрипт
 * ничего не делает и печатает кандидатов.
 *
 * Правка идёт теми же правилами, что кнопка «Изменить» на сайте
 * (editItemsRefusal, editedItemsRefusal, describeItemChanges, saveOrderItems):
 * отгруженную или оплаченную заявку не тронет, подтверждение менеджера снимет,
 * изменение суммы запишет в журнал денег. Цена новой позиции — из прайса
 * (у заявки в наш магазин — из внутреннего), как подставила бы форма.
 *
 * Запуск:  npx tsx scripts/edit-order-items.ts        — только показать
 *          npx tsx scripts/edit-order-items.ts --yes  — записать
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems, saveOrderItems, setOrderManagerConfirmed, getOrderById } from "../src/lib/repo/orders";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { logMoney } from "../src/lib/repo/moneyLog";
import { PRICE_KINDS, priceFromMap, priceMapForClient } from "../src/lib/priceList";
import { describeItemChanges, editItemsRefusal, editedItemsRefusal } from "../src/lib/orderEdit";
import { MONEY_EPSILON, MONEY_LOG_ACTIONS } from "../src/lib/constants";

const APPLY = process.argv.includes("--yes");
const OWNER = "y.sadakbayev@gmail.com";
const DELIVERY = "2026-09-15";
const SIGNATURE: [string, number][] = [
  ["Red Naomi", 60],
  ["Anna Karina", 60],
  ["Peach Avalanche", 60],
  ["Jumilia", 45],
  ["Kamala", 45],
  ["Мини-микс пионовидные", 320],
];

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

async function main() {
  const orders = await listOrdersWithItems();
  const matches = orders.filter(
    (o) =>
      o.deliveryDate.slice(0, 10) === DELIVERY &&
      o.status !== "cancelled" &&
      SIGNATURE.every(([v, q]) =>
        o.items.some((i) => i.flowerType === "rose" && i.variety === v && i.quantity === q)
      )
  );
  if (matches.length !== 1) {
    console.log(`Найдено заявок по составу: ${matches.length}. Нужна ровно одна — ничего не меняю.`);
    for (const o of matches) console.log(`  ${o.orderId} · ${o.clientName}`);
    process.exit(1);
  }
  const order = matches[0];
  console.log(`Заявка ${order.orderId} · ${order.clientName} · доставка ${order.deliveryDate} · ${order.managerEmail}`);
  console.log(`Статус ${order.status} · подтверждена ${order.managerConfirmed} · получено ${money(order.paidAmount)}`);
  console.log("Было:");
  for (const i of order.items)
    console.log(`  ${i.itemId} · ${i.flowerType} ${i.variety} ${i.grade} · ${i.quantity} шт × ${i.unitPrice} · отгружено ${i.shippedQuantity}`);

  // Обычная правка запрещена, если по заявке хоть что-то отгружено: уменьшать
  // сумму уехавшего цветка надо рекламацией. У заявки в НАШ магазин денег нет
  // вовсе, а правка касается только НЕотгруженных строк (это ниже проверяет
  // editedItemsRefusal: отгруженное не уменьшается и не удаляется). Поэтому для
  // магазина владелец правит напрямую.
  const refusal = order.retail ? "" : editItemsRefusal(order, "admin", OWNER);
  if (refusal) {
    console.log(`Правка невозможна: ${refusal}`);
    process.exit(1);
  }

  const kamala = order.items.find((i) => i.variety === "Kamala" && i.quantity === 45)!;
  const jumilia = order.items.find((i) => i.variety === "Jumilia" && i.quantity === 45)!;
  const grade = jumilia.grade; // «50»

  const kind = order.retail ? PRICE_KINDS.RETAIL : PRICE_KINDS.CLIENT;
  const priceMap = priceMapForClient(await getCurrentPrices(undefined, kind));
  let avalanchePrice = priceFromMap(priceMap, "rose", "Avalanche", grade);
  if (order.retail) {
    // В заявке магазина цены у всех строк свои (сейчас нули) — новая строка
    // должна быть такой же, иначе сумма перемещения станет разнобойной.
    avalanchePrice = jumilia.unitPrice;
    console.log(`Заявка в наш магазин — цена новой строки как у Jumilia ${grade}: ${avalanchePrice}`);
  } else if (!(avalanchePrice > 0)) {
    // В прайсе нет — берём цену соседней позиции той же длины в этой же заявке.
    avalanchePrice = jumilia.unitPrice;
    console.log(`В прайсе (${kind}) цены на Avalanche ${grade} нет — беру цену Jumilia ${grade}: ${avalanchePrice}`);
  } else {
    console.log(`Цена Avalanche ${grade} по прайсу (${kind}): ${avalanchePrice}`);
  }

  const existingAvalanche = order.items.find((i) => i.variety === "Avalanche" && i.grade === grade);
  const next = order.items
    .filter((i) => i.itemId !== kamala.itemId)
    .map((i) => ({
      itemId: i.itemId,
      flowerType: i.flowerType,
      variety: i.variety,
      grade: i.grade,
      quantity: i.itemId === jumilia.itemId ? 105 : existingAvalanche && i.itemId === existingAvalanche.itemId ? i.quantity + 60 : i.quantity,
      unitPrice: i.unitPrice,
    }));
  if (!existingAvalanche) {
    next.push({ itemId: "", flowerType: "rose", variety: "Avalanche", grade, quantity: 60, unitPrice: avalanchePrice });
  }

  const itemsRefusal = editedItemsRefusal({ current: order.items, next, region: false });
  if (itemsRefusal) {
    console.log(`Правка невозможна: ${itemsRefusal}`);
    process.exit(1);
  }
  const changes = describeItemChanges({ current: order.items, next, region: false });
  console.log("Изменения:");
  for (const c of changes) console.log(`  ${c}`);
  const newTotal = next.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  console.log(`Сумма: ${money(order.totalAmount)} → ${money(newTotal)}`);

  if (!APPLY) {
    console.log("\nЭто показ. Записать: --yes");
    return;
  }

  await saveOrderItems(
    order.orderId,
    next.map((i) => ({ ...i, flowerType: i.flowerType as "rose" }))
  );
  let unconfirmed = false;
  if (order.managerConfirmed) {
    await setOrderManagerConfirmed(order.orderId, false);
    unconfirmed = true;
  }
  const after = await getOrderById(order.orderId);
  const total = after?.totalAmount ?? order.totalAmount;
  if (Math.abs(total - order.totalAmount) > MONEY_EPSILON) {
    await logMoney({
      actorEmail: OWNER,
      orderId: order.orderId,
      action: MONEY_LOG_ACTIONS.ORDER_EDITED,
      details: `${changes.join("; ")} · по просьбе владельца${unconfirmed ? " · подтверждение снято" : ""}`,
      amountBefore: order.totalAmount,
      amountAfter: total,
    });
  }
  console.log("\nСтало:");
  for (const i of after?.items ?? [])
    console.log(`  ${i.itemId} · ${i.variety} ${i.grade} · ${i.quantity} шт × ${i.unitPrice}`);
  console.log(`Сумма ${money(total)}${unconfirmed ? " · подтверждение менеджера снято" : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
