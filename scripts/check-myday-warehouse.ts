/**
 * «Мой день» склада (19.10.2026): что отгрузить, что опаздывает, что ждёт, сколько лежит.
 *
 * Стережём не оформление, а границы и цифры: зав. складом не видит чужой цветок и офисные заявки, склад офиса —
 * только офисные; группы по дню доставки; готовность и «чего ждём» — те же правила, что на страницах склада;
 * «хватит на» считается без просроченного; повтор приёмки помечается.
 */
import { buildWarehouseDay, readyLabel, type WarehouseDayInput } from "../src/lib/myDay/warehouse";
import type { Batch, OrderWithItems, Shipment } from "../src/lib/types";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-10-19";
const NOW = new Date("2026-10-19T03:00:00Z"); // 08:00 по Алматы (UTC+5)
const day = (shift: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
};

type Item = { flowerType: string; variety: string; grade: string; quantity: number; shippedQuantity?: number };
function order(p: Partial<Omit<OrderWithItems, "items">> & { orderId: string; items: Item[] }): OrderWithItems {
  const items = p.items.map((i, n) => ({ itemId: `${p.orderId}-${n}`, orderId: p.orderId, unitPrice: 200, shippedQuantity: i.shippedQuantity ?? 0, flowerType: i.flowerType, variety: i.variety, grade: i.grade, quantity: i.quantity }));
  return {
    createdAt: `${day(-1)}T10:00:00`,
    managerEmail: "ilyas@x.kz",
    clientName: "Клиент",
    clientPhone: "",
    deliveryDate: TODAY,
    status: "new",
    notes: "",
    managerConfirmed: true,
    paid: true,
    paidAmount: 100,
    retail: "",
    kind: "",
    direction: "",
    store: "",
    ...p,
    items,
    totalAmount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
  } as unknown as OrderWithItems;
}
function batch(p: Partial<Batch> & { batchId: string; flowerType: string; grade: string; quantityRemaining: number }): Batch {
  return {
    receivedAt: `${day(-2)}T09:00:00Z`,
    harvestDate: day(-2),
    variety: "Jumilia",
    quantityIn: p.quantityRemaining,
    location: "",
    receivedByEmail: "r@x.kz",
    store: "",
    sourceBatchId: "",
    ...p,
  } as Batch;
}
const settings = { shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 }, warningThreshold: 0.7 };

const orders: OrderWithItems[] = [
  // Опаздывает с пятницы, оплачена, смешанная: у Rose Farm остаётся только роза.
  order({ orderId: "ORD-1-LATE1", clientName: "Розовый сад", deliveryDate: day(-3), items: [{ flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 1500 }, { flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantity: 300 }] }),
  // Сегодня, в долг по условиям клиента.
  order({ orderId: "ORD-2-TODAY", clientName: "ИП Жанкожа", paid: false, paidAmount: 0, clientPaymentTerms: "Отсрочка 7 дней", items: [{ flowerType: "rose", variety: "Red Naomi", grade: "70", quantity: 400, shippedQuantity: 100 }] }),
  // Сегодня, наш магазин.
  order({ orderId: "ORD-3-SHOP", clientName: "Цветочник, Достык 27", retail: "almaty", paid: false, paidAmount: 0, items: [{ flowerType: "rose", variety: "Мини-микс кустовые", grade: "Мини-микс", quantity: 400 }] }),
  // Завтра.
  order({ orderId: "ORD-4-TMRW", clientName: "Букет Сити", deliveryDate: day(1), items: [{ flowerType: "rose", variety: "Prestige", grade: "50", quantity: 1200 }] }),
  // Позже.
  order({ orderId: "ORD-5-LATER", clientName: "Флора", deliveryDate: day(3), items: [{ flowerType: "rose", variety: "Prestige", grade: "50", quantity: 700 }] }),
  // Ждёт галочки менеджера.
  order({ orderId: "ORD-6-WAIT", clientName: "Цветы 24", managerConfirmed: false, paid: false, paidAmount: 0, deliveryDate: day(1), items: [{ flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 800 }] }),
  // Только хризантема — Rose Farm не видит вовсе.
  order({ orderId: "ORD-7-CHRYS", clientName: "Магнолия", items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 1200 }] }),
  // Офисная заявка — основной склад её не видит, офис видит.
  order({ orderId: "ORD-8-OFFIC", clientName: "Салон «Пион»", clientPhone: "+77010001122", store: "office", items: [{ flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 100 }] }),
  // Отгружена — не в очереди.
  order({ orderId: "ORD-9-DONE", status: "shipped", items: [{ flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 100, shippedQuantity: 100 }] }),
];

const batches: Batch[] = [
  batch({ batchId: "B1", flowerType: "rose", grade: "60", quantityRemaining: 2000, harvestDate: day(-1), receivedAt: `${TODAY}T02:20:00Z` }),
  batch({ batchId: "B1b", flowerType: "rose", grade: "60", quantityRemaining: 2000, harvestDate: day(-1), receivedAt: `${TODAY}T02:31:00Z` }),
  batch({ batchId: "B2", flowerType: "rose", grade: "60", quantityRemaining: 500, harvestDate: day(-9) }), // дольше срока
  batch({ batchId: "B3", flowerType: "rose", grade: "50", quantityRemaining: 1000, harvestDate: day(-6), variety: "Prestige" }), // скоро
  batch({ batchId: "B4", flowerType: "chrysanthemum", grade: "Первая", quantityRemaining: 3000, variety: "Altaj" }),
  batch({ batchId: "B5", flowerType: "rose", grade: "60", quantityRemaining: 300, store: "office", sourceBatchId: "B1" }),
  batch({ batchId: "B6", flowerType: "rose", grade: "40", quantityRemaining: 0 }),
];
const shipments: Shipment[] = [
  { shipmentId: "S1", createdAt: `${day(-2)}T10:00:00Z`, orderId: "ORD-9-DONE", itemId: "x", batchId: "B1", quantity: 700, warehouseEmail: "", notes: "" },
  { shipmentId: "S2", createdAt: `${day(-10)}T10:00:00Z`, orderId: "ORD-9-DONE", itemId: "x", batchId: "B1", quantity: 9000, warehouseEmail: "", notes: "" },
  { shipmentId: "S3", createdAt: `${day(-1)}T10:00:00Z`, orderId: "ORD-8-OFFIC", itemId: "x", batchId: "B5", quantity: 100, warehouseEmail: "", notes: "" },
];

const base: WarehouseDayInput = { role: "warehouse", farm: "rose_farm", email: "razia@x.kz", orders, batches, shipments, settings, today: TODAY, now: NOW };
const w = buildWarehouseDay(base);

console.log("--- Зав. складом Rose Farm");
check("опаздывает одна, стебли только розы", w.queue.late.map((r) => [r.code, r.stems]), [["LATE1", 1500]]);
check("позиции одной строкой, без чужого цветка", w.queue.late[0].lines, `Jumilia 60 см — ${(1500).toLocaleString("ru-RU")}`);
check("сегодня: в долг и магазин, по срочности", w.queue.today.map((r) => r.code), ["TODAY", "SHOP"]);
check("остаток к отгрузке с учётом отгруженного", w.queue.today[0].stems, 300);
check("метка «в долг» с условиями", w.queue.today[0].ready, "готова · в долг · Отсрочка 7 дней");
check("метка магазина", w.queue.today[1].ready, "готова · Розница Алматы");
check("метка оплаченной", readyLabel(orders[0]), "готова · оплачена");
check("завтра — Букет Сити", w.queue.tomorrow.map((r) => r.client), ["Букет Сити"]);
check("позже — свёрнуто числом", [w.queue.laterCount, w.queue.laterStems], [1, 700]);
check("ждёт галочки — с причиной", w.waiting.map((r) => [r.code, r.reason]), [["WAIT", "Ждёт подтверждения менеджера и оплаты"]]);
check("хризантема и офис не попали", JSON.stringify(w).includes("CHRYS") || JSON.stringify(w).includes("OFFIC"), false);
check("плитки: сегодня", [w.tiles.todayOrders, w.tiles.todayStems], [2, 700]);
check("плитки: опаздывают", [w.tiles.late, w.tiles.lateStems], [1, 1500]);
check("плитки: ждут", w.tiles.waiting, 1);
check("склад: основной, своя роза, без офиса и хризантемы", w.tiles.stockStems, 5500);
check("дольше срока и скоро", [w.tiles.criticalStems, w.tiles.warningStems], [500, 1000]);
check("хватит на — без просроченного, по неделе (5000 / 100 в день)", w.tiles.coverDays, 50);
check("строки склада в порядке длин", w.grades.map((g) => [g.label, g.qty]), [["Роза 50 см", 1000], ["Роза 60 см", 4500]]);
check("доли срока у 60 см", w.grades[1].critical.toFixed(2), (500 / 4500).toFixed(2));
check("принято сегодня: две партии, обе похожи на повтор", w.received.map((r) => [r.qty, r.duplicate, r.time]), [[2000, true, "07:31"], [2000, true, "07:20"]]);
check("ссылка на отгрузку", w.queue.late[0].href, "/warehouse/ship/ORD-1-LATE1");

console.log("--- Склад офиса");
const o = buildWarehouseDay({ ...base, role: "office", farm: null, email: "ruslan@x.kz" });
check("офис видит только офисную заявку, с телефоном", o.queue.today.map((r) => [r.code, r.note]), [["OFFIC", "+77010001122"]]);
check("офис: склад — только офисные партии", o.tiles.stockStems, 300);
check("офис: хватит на — по офисным отгрузкам (300 / 100 в 7 дней)", o.tiles.coverDays, 21);
check("офис: приёмки нет", o.received, []);
check("офис: ждать нечего", o.waiting, []);

console.log("--- Нет отгрузок за неделю");
const q = buildWarehouseDay({ ...base, shipments: [] });
check("хватит на — неизвестно", q.tiles.coverDays, null);

if (fails > 0) {
  console.log(`\nПровалено проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
