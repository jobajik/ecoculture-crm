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
import { shipmentPartsRefusal, shipmentRefusal, statusAfterShipping } from "../src/lib/shipRules";
import { isQuotaError } from "../src/lib/sheets";

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

// ---------------------------------------------------------------------------
// Отгрузка из нескольких партий одним нажатием (просьба зав. складом Rose Farm:
// 310 стеблей из десяти партий отгружались десятью нажатиями)
// ---------------------------------------------------------------------------

const B = (id: string, left: number, over: Partial<typeof BATCH> = {}) =>
  [id, { ...BATCH, batchId: id, quantityRemaining: left, ...over }] as const;
const STORE = new Map([B("P1", 70), B("P2", 90), B("P3", 30), B("P4", 500)]);
const ITEM310 = { ...ITEM, quantity: 310 };
const parts = (...p: [string, number][]) => p.map(([batchId, quantity]) => ({ batchId, quantity }));

check(
  "случай со снимка: 70 + 90 + 30 + 120 = 310 одним нажатием",
  shipmentPartsRefusal({
    orderId: "ORD-1",
    item: ITEM310,
    batches: STORE,
    parts: parts(["P1", 70], ["P2", 90], ["P3", 30], ["P4", 120]),
  }),
  ""
);
check(
  "каждая часть в пределах, а вместе больше заказа — отказ",
  refused(
    shipmentPartsRefusal({
      orderId: "ORD-1",
      item: ITEM310,
      batches: STORE,
      parts: parts(["P1", 70], ["P2", 90], ["P4", 200]),
    })
  ),
  true
);
check(
  "текст отказа говорит про сумму, а не про последнюю партию",
  shipmentPartsRefusal({
    orderId: "ORD-1",
    item: ITEM310,
    batches: STORE,
    parts: parts(["P1", 70], ["P2", 90], ["P4", 200]),
  }),
  "Отмечено 360 шт., а по позиции осталось отгрузить 310 шт."
);
check(
  "уже отгруженное учитывается",
  refused(
    shipmentPartsRefusal({
      orderId: "ORD-1",
      item: { ...ITEM310, shippedQuantity: 300 },
      batches: STORE,
      parts: parts(["P1", 5], ["P2", 6]),
    })
  ),
  true
);
check(
  "одна партия дважды — отказ, а не сложение",
  refused(
    shipmentPartsRefusal({
      orderId: "ORD-1",
      item: ITEM310,
      batches: STORE,
      parts: parts(["P1", 30], ["P1", 30]),
    })
  ),
  true
);
check(
  "в одной из партий не хватает — отказ всей отгрузки",
  refused(
    shipmentPartsRefusal({
      orderId: "ORD-1",
      item: ITEM310,
      batches: STORE,
      parts: parts(["P1", 70], ["P3", 40]),
    })
  ),
  true
);
check(
  "чужой сорт в одной из партий — отказ всей отгрузки",
  refused(
    shipmentPartsRefusal({
      orderId: "ORD-1",
      item: ITEM310,
      batches: new Map([...STORE, B("P5", 100, { variety: "Avalanche" })]),
      parts: parts(["P1", 70], ["P5", 10]),
    })
  ),
  true
);
check(
  "неизвестная партия и пустой список — отказ",
  [
    refused(shipmentPartsRefusal({ orderId: "ORD-1", item: ITEM310, batches: STORE, parts: parts(["NOPE", 1]) })),
    refused(shipmentPartsRefusal({ orderId: "ORD-1", item: ITEM310, batches: STORE, parts: [] })),
  ],
  [true, true]
);
check(
  "позиция чужой заявки отклоняется и для нескольких партий",
  refused(shipmentPartsRefusal({ orderId: "ORD-2", item: ITEM310, batches: STORE, parts: parts(["P1", 10]) })),
  true
);

check(
  "статус после отгрузки",
  [
    statusAfterShipping("new", [{ quantity: 310, shippedQuantity: 310 }]),
    statusAfterShipping("new", [{ quantity: 310, shippedQuantity: 100 }, { quantity: 50, shippedQuantity: 0 }]),
    statusAfterShipping("new", [{ quantity: 310, shippedQuantity: 0 }]),
    statusAfterShipping("cancelled", [{ quantity: 10, shippedQuantity: 10 }]),
  ],
  ["shipped", "in_progress", "new", "cancelled"]
);

check(
  "лимит Google узнаётся",
  [
    isQuotaError({ code: 429 }),
    isQuotaError({ response: { status: 429 } }),
    isQuotaError(new Error("Quota exceeded for quota metric 'Read requests'")),
    isQuotaError(new Error("Превышен лимит запросов")),
    isQuotaError(new Error("Партия не найдена")),
    isQuotaError({ code: 403 }),
  ],
  [true, true, true, true, false, false]
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
