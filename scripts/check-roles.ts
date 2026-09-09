/*
 * Матрица прав и правила жизненного цикла заявки.
 *
 * Проверяется то, что нельзя увидеть глазами и что не ловят ни сборка, ни
 * типы: кто что может делать. Каждая строка здесь — дыра, которая уже была
 * найдена в коде при аудите перед боевым запуском.
 *
 * Запуск: npx tsx scripts/check-roles.ts
 */
import { ROLES, ORDER_STATUSES } from "../src/lib/constants";
import { cancelRefusal, isClosed, moneyRefusal } from "../src/lib/orderRules";
import { shipmentRefusal } from "../src/lib/shipRules";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

/** Отказ есть (текст не важен) или его нет. */
function refused(text: string): boolean {
  return text.length > 0;
}

// ---------------------------------------------------------------------------
// Отмена заявки
// ---------------------------------------------------------------------------

const MINE = "aliya@ecoculture.kz";
const OTHER = "emil@ecoculture.kz";

function order(over: Partial<Parameters<typeof cancelRefusal>[0]> = {}) {
  return {
    status: ORDER_STATUSES.NEW,
    managerEmail: MINE,
    items: [{ shippedQuantity: 0 }],
    ...over,
  };
}

check("свой менеджер отменяет свою заявку", refused(cancelRefusal(order(), ROLES.MANAGER, MINE)), false);
check("админ отменяет любую", refused(cancelRefusal(order(), ROLES.ADMIN, OTHER)), false);
check(
  "менеджер НЕ отменяет чужую",
  refused(cancelRefusal(order(), ROLES.MANAGER, OTHER)),
  true
);
check("бухгалтер НЕ отменяет", refused(cancelRefusal(order(), ROLES.ACCOUNTANT, MINE)), true);
check("зав. складом НЕ отменяет", refused(cancelRefusal(order(), ROLES.WAREHOUSE, MINE)), true);
check("агроном НЕ отменяет", refused(cancelRefusal(order(), ROLES.AGRONOMIST, MINE)), true);
check("РОП НЕ отменяет", refused(cancelRefusal(order(), ROLES.SALES_HEAD, MINE)), true);
check("без роли НЕ отменяет", refused(cancelRefusal(order(), "", MINE)), true);
check("пустая роль из таблицы НЕ отменяет", refused(cancelRefusal(order(), null, MINE)), true);

check(
  "отгруженную не отменяют",
  refused(cancelRefusal(order({ status: ORDER_STATUSES.SHIPPED }), ROLES.ADMIN, MINE)),
  true
);
check(
  "отменённую не отменяют дважды",
  refused(cancelRefusal(order({ status: ORDER_STATUSES.CANCELLED }), ROLES.ADMIN, MINE)),
  true
);
check(
  "частично отгруженную не отменяют — цветок уже уехал",
  refused(cancelRefusal(order({ items: [{ shippedQuantity: 200 }] }), ROLES.ADMIN, MINE)),
  true
);

// Почта из сессии приходит как есть, а в таблице приведена к нижнему регистру.
check(
  "регистр почты не мешает отменить свою заявку",
  refused(cancelRefusal(order(), ROLES.MANAGER, "Aliya@Ecoculture.KZ")),
  false
);

// ---------------------------------------------------------------------------
// Деньги по закрытой заявке
// ---------------------------------------------------------------------------

check("по новой заявке деньги проводятся", refused(moneyRefusal(ORDER_STATUSES.NEW)), false);
check("по заявке в работе — тоже", refused(moneyRefusal(ORDER_STATUSES.IN_PROGRESS)), false);
check("с отгруженной оплату не снять", refused(moneyRefusal(ORDER_STATUSES.SHIPPED)), true);
check("по отменённой денег нет", refused(moneyRefusal(ORDER_STATUSES.CANCELLED)), true);
check("закрытость: отгружена", isClosed(ORDER_STATUSES.SHIPPED), true);
check("закрытость: отменена", isClosed(ORDER_STATUSES.CANCELLED), true);
check("закрытость: новая — нет", isClosed(ORDER_STATUSES.NEW), false);

// ---------------------------------------------------------------------------
// Отгрузка: что обязан проверить сервер
// ---------------------------------------------------------------------------

const ITEM = {
  itemId: "ORD-1-I1",
  orderId: "ORD-1",
  flowerType: "rose",
  variety: "Prestige",
  grade: "60 см",
  quantity: 1000,
  shippedQuantity: 0,
};
const BATCH = {
  batchId: "BATCH-1",
  flowerType: "rose",
  variety: "Prestige",
  grade: "60 см",
  quantityRemaining: 5000,
};

check(
  "обычная отгрузка проходит",
  refused(shipmentRefusal({ orderId: "ORD-1", item: ITEM, batch: BATCH, quantity: 400 })),
  false
);
check(
  "больше, чем заказано, отгрузить нельзя",
  refused(shipmentRefusal({ orderId: "ORD-1", item: ITEM, batch: BATCH, quantity: 1200 })),
  true
);
check(
  "повторная отгрузка сверх остатка позиции",
  refused(
    shipmentRefusal({
      orderId: "ORD-1",
      item: { ...ITEM, shippedQuantity: 1000 },
      batch: BATCH,
      quantity: 1000,
    })
  ),
  true
);
check(
  "добрать остаток позиции можно",
  refused(
    shipmentRefusal({
      orderId: "ORD-1",
      item: { ...ITEM, shippedQuantity: 600 },
      batch: BATCH,
      quantity: 400,
    })
  ),
  false
);
check(
  "позиция чужой заявки отклоняется",
  refused(
    shipmentRefusal({ orderId: "ORD-2", item: ITEM, batch: BATCH, quantity: 100 })
  ),
  true
);
check(
  "чужой сорт из партии не отгрузишь",
  refused(
    shipmentRefusal({
      orderId: "ORD-1",
      item: ITEM,
      batch: { ...BATCH, variety: "Avalanche" },
      quantity: 100,
    })
  ),
  true
);
check(
  "другая длина не отгружается",
  refused(
    shipmentRefusal({
      orderId: "ORD-1",
      item: ITEM,
      batch: { ...BATCH, grade: "40 см" },
      quantity: 100,
    })
  ),
  true
);
check(
  "разный регистр сорта не мешает",
  refused(
    shipmentRefusal({
      orderId: "ORD-1",
      item: ITEM,
      batch: { ...BATCH, variety: " prestige " },
      quantity: 100,
    })
  ),
  false
);
check(
  "больше, чем в партии",
  refused(
    shipmentRefusal({
      orderId: "ORD-1",
      item: ITEM,
      batch: { ...BATCH, quantityRemaining: 50 },
      quantity: 100,
    })
  ),
  true
);
check(
  "ноль и минус не проходят",
  [
    refused(shipmentRefusal({ orderId: "ORD-1", item: ITEM, batch: BATCH, quantity: 0 })),
    refused(shipmentRefusal({ orderId: "ORD-1", item: ITEM, batch: BATCH, quantity: -100 })),
    refused(shipmentRefusal({ orderId: "ORD-1", item: ITEM, batch: BATCH, quantity: 10.5 })),
  ],
  [true, true, true]
);
check(
  "нет позиции или партии",
  [
    refused(shipmentRefusal({ orderId: "ORD-1", item: null, batch: BATCH, quantity: 10 })),
    refused(shipmentRefusal({ orderId: "ORD-1", item: ITEM, batch: null, quantity: 10 })),
  ],
  [true, true]
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
