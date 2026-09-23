/*
 * Этап заявки, опоздание и «Отгрузить всю заявку».
 *
 * Этап — одно слово на всех экранах и «чей ход» (`orderStage`). Ломается он
 * тихо: заявка, показанная «готовой», которую сервер не даст отгрузить, хуже,
 * чем старое «Новая» у всех. Поэтому готовность здесь сверяется с той же
 * функцией, что открывает отгрузку на сервере.
 *
 * «Отгрузить всё» раскладывает заявку по партиям от старых к свежим
 * (`planWholeOrderShipment`) — проверяем, что общая партия не делится дважды,
 * что недостача честно видна и что отгружено больше заказанного не бывает.
 *
 * Запуск: npx tsx scripts/check-order-stage.ts
 */
import { orderStage, byUrgency, type StageOrder } from "../src/lib/orderStage";
import { isReadyToShip } from "../src/lib/orderReady";
import { planWholeOrderShipment } from "../src/lib/shipRules";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-09-23";
const o = (p: Partial<StageOrder>): StageOrder => ({
  status: "new",
  deliveryDate: "2026-09-24",
  managerConfirmed: true,
  paid: true,
  paidAmount: 100,
  totalAmount: 100,
  items: [{ quantity: 10, shippedQuantity: 0 }],
  ...p,
});

console.log("\n— Этап —");
check("не подтверждена → ждёт менеджера", [orderStage(o({ managerConfirmed: false }), TODAY).key, orderStage(o({ managerConfirmed: false }), TODAY).actor], ["wait_confirm", "менеджер"]);
check("розница ждёт менеджера розницы", orderStage(o({ managerConfirmed: false, retail: "almaty" }), TODAY).actor, "менеджер розницы");
check("не оплачена → ждёт бухгалтера", orderStage(o({ paid: false, paidAmount: 0 }), TODAY).key, "wait_money");
check("предоплата — «ждёт остатка»", orderStage(o({ paid: false, paidAmount: 40 }), TODAY).label, "Ждёт остатка оплаты");
check("в долг по условиям → готова · в долг", orderStage(o({ paid: false, paidAmount: 0, clientPaymentTerms: "Отсрочка 7 дней" }), TODAY).label, "Готова · в долг");
check("готова → ход склада", [orderStage(o({}), TODAY).key, orderStage(o({}), TODAY).actor], ["ready", "склад"]);
check("частично отгружена", orderStage(o({ status: "in_progress", items: [{ quantity: 10, shippedQuantity: 4 }] }), TODAY).key, "partly");
check("всё отгружено, даже если статус не обновился", orderStage(o({ items: [{ quantity: 10, shippedQuantity: 10 }] }), TODAY).key, "shipped");
check("отменена — без хода", [orderStage(o({ status: "cancelled" }), TODAY).key, orderStage(o({ status: "cancelled" }), TODAY).actor], ["cancelled", ""]);
check("городская заявка без счёта: подтверждена — готова", orderStage(o({ kind: "region", paid: false, paidAmount: 0, totalAmount: 0 }), TODAY).key, "ready");

console.log("\n— Готовность совпадает с сервером —");
const samples: Partial<StageOrder>[] = [
  {},
  { managerConfirmed: false },
  { paid: false, paidAmount: 0 },
  { paid: false, paidAmount: 0, clientPaymentTerms: "По факту" },
  { paid: false, paidAmount: 50, clientPaymentTerms: "Предоплата" },
  { retail: "almaty", paid: false, paidAmount: 0 },
];
check(
  "«готова/частично» ровно тогда, когда сервер пустит отгружать",
  samples.map((p) => {
    const st = orderStage(o(p), TODAY).key;
    return (st === "ready" || st === "partly") === isReadyToShip(o(p));
  }),
  samples.map(() => true)
);

console.log("\n— Опоздание —");
check("доставка вчера — 1 день", orderStage(o({ deliveryDate: "2026-09-22" }), TODAY).lateDays, 1);
check("доставка сегодня — не опоздание", orderStage(o({ deliveryDate: TODAY }), TODAY).lateDays, 0);
check("без даты — не опоздание", orderStage(o({ deliveryDate: "" }), TODAY).lateDays, 0);
check("отгруженная не опаздывает", orderStage(o({ deliveryDate: "2026-09-01", status: "shipped" }), TODAY).lateDays, 0);
check("опаздывает и ждущая оплаты (опоздание не только у склада)", orderStage(o({ deliveryDate: "2026-09-20", paid: false, paidAmount: 0 }), TODAY).lateDays, 3);
const list = [o({ deliveryDate: "2026-09-25" }), o({ deliveryDate: "2026-09-10" }), o({ deliveryDate: "2026-09-20" }), o({ deliveryDate: "2026-09-24" })];
check(
  "очередь: сначала давние опоздания, потом по дню доставки",
  [...list].sort(byUrgency((x: StageOrder) => orderStage(x, TODAY))).map((x) => x.deliveryDate),
  ["2026-09-10", "2026-09-20", "2026-09-24", "2026-09-25"]
);

console.log("\n— Отгрузить всю заявку —");
const items = [
  { itemId: "I1", flowerType: "rose", variety: "Avalanche", grade: "60", quantity: 300, shippedQuantity: 0 },
  { itemId: "I2", flowerType: "rose", variety: "avalanche ", grade: "60", quantity: 100, shippedQuantity: 0 },
  { itemId: "I3", flowerType: "rose", variety: "Kamala", grade: "50", quantity: 50, shippedQuantity: 20 },
  { itemId: "I4", flowerType: "rose", variety: "Jana", grade: "40", quantity: 10, shippedQuantity: 10 },
];
const batches = [
  { batchId: "B-new", flowerType: "rose", variety: "Avalanche", grade: "60", harvestDate: "2026-09-20", quantityRemaining: 200 },
  { batchId: "B-old", flowerType: "rose", variety: "Avalanche", grade: "60", harvestDate: "2026-09-15", quantityRemaining: 150 },
  { batchId: "K", flowerType: "rose", variety: "Kamala", grade: "50", harvestDate: "2026-09-18", quantityRemaining: 500 },
  { batchId: "X", flowerType: "rose", variety: "Kamala", grade: "60", harvestDate: "2026-09-10", quantityRemaining: 500 },
];
const plan = planWholeOrderShipment(items, batches);
check("первая позиция — сначала старая партия", plan.lines[0], { itemId: "I1", parts: [{ batchId: "B-old", quantity: 150 }, { batchId: "B-new", quantity: 150 }] });
check("вторая позиция того же сорта берёт только остаток партии", plan.lines[1], { itemId: "I2", parts: [{ batchId: "B-new", quantity: 50 }] });
check("недостача видна", plan.shortages, [{ itemId: "I2", label: "avalanche  60", missing: 50 }]);
check("частично отгруженная — только остаток, и не из чужой длины", plan.lines[2], { itemId: "I3", parts: [{ batchId: "K", quantity: 30 }] });
check("отгруженная целиком не трогается", plan.lines.some((l) => l.itemId === "I4"), false);
check("итог", plan.total, 380);
check("пустой склад — ничего не отгружается", planWholeOrderShipment(items, []).total, 0);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
