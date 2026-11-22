/*
 * Погрузка фуры в город зав. складом и продажа только со склада города (22.11.2026, владелец: «с производства
 * перемещение делали зав. склады и я видел стоки их по городам… оттуда менеджеры [города] только могли продавать…
 * им было легко работать с формой, если каких-то позиций нет»).
 *
 * Стережём обе стороны. Пропустим лишнее — склад отгрузит больше, чем лежит, или чужой цветок; закрытая позиция потеряет
 * «сколько просили», и город не узнает, чего не будет; менеджер города продаст с основного склада мимо фуры. Откажем
 * зря — склад не сможет ответить «нет на складе», и заказ города так и будет висеть недогруженным.
 *
 * Запуск: npx tsx scripts/check-truck-load.ts
 */
import { EXTRA_NOTE, REST_OPTIONS, isWarehouseExtra, mainStockMap, planTruckLoad, restOption, stockKey, warehouseReply, type LoadPlan } from "../src/lib/truckLoad";
import { canLoadTrucks, cityShortage, cityStockMatrix, regionAccess } from "../src/lib/regionTruck";
import { newOrderStore, storeChangeRefusal } from "../src/lib/officeStore";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const has = (text: unknown, part: string) => typeof text === "string" && text.includes(part);

// --- Склад и заказ города --------------------------------------------------------------
const batches = [
  { batchId: "B1", flowerType: "rose", variety: "Red Naomi", grade: "60", harvestDate: "2026-11-18", quantityRemaining: 200 },
  { batchId: "B2", flowerType: "rose", variety: "Red Naomi", grade: "60", harvestDate: "2026-11-20", quantityRemaining: 300 },
  { batchId: "B3", flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", harvestDate: "2026-11-19", quantityRemaining: 1000 },
  { batchId: "B4", flowerType: "rose", variety: "Jumilia", grade: "50", harvestDate: "2026-11-20", quantityRemaining: 90 },
];
const items = [
  { orderId: "ORD-1", itemId: "I1", flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 400, shippedQuantity: 0 },
  { orderId: "ORD-1", itemId: "I2", flowerType: "rose", variety: "Jumilia", grade: "50", quantity: 300, shippedQuantity: 0 },
  { orderId: "ORD-1", itemId: "I3", flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 500, shippedQuantity: 0 },
  { orderId: "ORD-2", itemId: "I4", flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 150, shippedQuantity: 50 },
];
const plan = (lines: { itemId: string; load: number; rest: string }[], extras: { flowerType: string; variety: string; grade: string; quantity: number; note?: string }[] = [], farm: string | null = null) =>
  planTruckLoad({ items, batches, lines, extras, farm });
const ok = (p: LoadPlan | string) => (typeof p === "string" ? null : p);

console.log("\n— Ответы склада —");
check("три ответа: нет / качество / догружу позже", REST_OPTIONS.map((o) => `${o.code}:${o.closes}`), ["none:true", "quality:true", "keep:false"]);
check("незнакомый ответ — не ответ", restOption("whatever"), null);

console.log("\n— Гружу всё, что просили —");
const full = ok(plan([{ itemId: "I1", load: 400, rest: "" }]));
check("уезжает 400", full?.total, 400);
check("раскладка от старой срезки к свежей", full?.ship[0].parts, [{ batchId: "B1", quantity: 200 }, { batchId: "B2", quantity: 200 }]);
check("ничего не закрыто", [full?.trims.length, full?.closedShort], [0, 0]);

console.log("\n— Части нет на складе —");
const short = ok(plan([{ itemId: "I2", load: 90, rest: "none" }]));
check("уезжает 90", short?.total, 90);
check("позиция закрыта: количество — факт, «просили» сохранено, причина записана", short?.trims, [{ orderId: "ORD-1", itemId: "I2", quantity: 90, asked: 300, note: "нет на складе" }]);
check("город не получит 210", short?.closedShort, 210);
const zero = ok(plan([{ itemId: "I2", load: 0, rest: "quality" }]));
check("ноль с причиной «не прошло по качеству» — позиция закрыта на нуле", zero?.trims, [{ orderId: "ORD-1", itemId: "I2", quantity: 0, asked: 300, note: "не прошло по качеству" }]);
check("…и ничего не уезжает", [zero?.total, zero?.ship.length], [0, 0]);
const keep = ok(plan([{ itemId: "I2", load: 90, rest: "keep" }]));
check("«догружу позже» — позиция остаётся открытой", [keep?.total, keep?.trims.length, keep?.closedShort], [90, 0, 0]);
check("меньше, чем просили, без ответа — отказ", has(plan([{ itemId: "I2", load: 90, rest: "" }]), "укажите, что с остальным"), true);

console.log("\n— Уже частично отгруженная позиция —");
const part = ok(plan([{ itemId: "I4", load: 60, rest: "none" }]));
check("закрытие считает и отгруженное раньше: 50 + 60", part?.trims[0], { orderId: "ORD-2", itemId: "I4", quantity: 110, asked: 150, note: "нет на складе" });
check("больше остатка по позиции — отказ", has(plan([{ itemId: "I4", load: 101, rest: "" }]), "осталось отгрузить 100"), true);

console.log("\n— Склад не резиновый —");
check("больше, чем лежит, — отказ с цифрой", has(plan([{ itemId: "I2", load: 300, rest: "" }]), "только 90"), true);
check("две строки одного сорта не берут один стебель", has(plan([{ itemId: "I1", load: 400, rest: "" }, { itemId: "I4", load: 100, rest: "" }]), "500"), false);
const both = plan([{ itemId: "I1", load: 400, rest: "" }, { itemId: "I4", load: 100, rest: "" }]);
check("…ровно 500 на двоих — проходит", ok(both)?.total, 500);
check("…а 501 на двоих (с добавкой) — отказ", typeof plan([{ itemId: "I1", load: 400, rest: "" }, { itemId: "I4", load: 100, rest: "" }], [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 1 }]), "string");

console.log("\n— Мусор и чужое —");
check("незнакомая позиция — «заказ изменился»", has(plan([{ itemId: "NOPE", load: 1, rest: "" }]), "Заказ изменился"), true);
check("позиция дважды — отказ", has(plan([{ itemId: "I1", load: 1, rest: "keep" }, { itemId: "I1", load: 1, rest: "keep" }]), "дважды"), true);
check("дробное количество — отказ", has(plan([{ itemId: "I1", load: 1.5, rest: "keep" }]), "целое число"), true);
check("минус — отказ", has(plan([{ itemId: "I1", load: -5, rest: "keep" }]), "целое число"), true);
check("пустая погрузка — отказ", has(plan([]), "Укажите, что грузите"), true);
check("Есентай не грузит розу", has(plan([{ itemId: "I1", load: 100, rest: "keep" }], [], "esentai"), "другого производства"), true);
check("Rose Farm не грузит хризантему Есентая", has(plan([{ itemId: "I3", load: 100, rest: "keep" }], [], "rose_farm"), "другого производства"), true);
check("Есентай грузит свою хризантему", ok(plan([{ itemId: "I3", load: 500, rest: "" }], [], "esentai"))?.total, 500);

console.log("\n— Склад добавляет своё (замена или без заказа) —");
const extra = ok(plan([{ itemId: "I2", load: 0, rest: "none" }], [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 100, note: "вместо Jumilia" }]));
check("добавленная позиция уезжает", extra?.total, 100);
check("пометка «Добавил склад: …»", extra?.extras[0]?.note, `${EXTRA_NOTE}: вместо Jumilia`);
check("раскладка добавленного по партиям", extra?.extras[0]?.parts, [{ batchId: "B1", quantity: 100 }]);
const adhoc = ok(planTruckLoad({ items: [], batches, lines: [], extras: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 60 }, { flowerType: "rose", variety: "red naomi ", grade: "60", quantity: 40 }], farm: null }));
check("без заказа города: одинаковые строки складываются", [adhoc?.extras.length, adhoc?.extras[0]?.quantity, adhoc?.total], [1, 100, 100]);
check("добавка без сорта — отказ", has(plan([], [{ flowerType: "rose", variety: " ", grade: "60", quantity: 10 }]), "сорт"), true);
check("добавка с длиной не из списка — отказ", has(plan([], [{ flowerType: "rose", variety: "Red Naomi", grade: "61,5", quantity: 10 }]), "из списка"), true);
check("добавка чужого цветка — отказ", has(plan([], [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 10 }], "esentai"), "другого производства"), true);
check("добавка незнакомого цветка — отказ", has(plan([], [{ flowerType: "tulip", variety: "X", grade: "60", quantity: 10 }]), "из списка"), true);
check("добавка с нулём — просто пропускается", has(plan([], [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 0 }]), "Укажите, что грузите"), true);

console.log("\n— Что видит город —");
check("позиция без ответа склада: просили = количество", warehouseReply({ quantity: 300 }), { asked: 300, missing: 0, note: "", extra: false });
check("закрытая позиция: просили 300, приедет 90, не будет 210", warehouseReply({ quantity: 90, askedQuantity: 300, stockNote: "нет на складе" }), { asked: 300, missing: 210, note: "нет на складе", extra: false });
check("добавил склад: город не просил", warehouseReply({ quantity: 100, stockNote: `${EXTRA_NOTE}: вместо Jumilia` }), { asked: 0, missing: 0, note: `${EXTRA_NOTE}: вместо Jumilia`, extra: true });
check("пометку склада узнаём по началу", [isWarehouseExtra(EXTRA_NOTE), isWarehouseExtra("нет на складе"), isWarehouseExtra(undefined)], [true, false, false]);

console.log("\n— Остаток для экрана погрузки —");
const stock = mainStockMap([...batches, { flowerType: "rose", variety: "red naomi ", grade: "60", quantityRemaining: 10 }, { flowerType: "rose", variety: "Empty", grade: "60", quantityRemaining: 0 }], null);
check("«Red Naomi» и «red naomi » — одна позиция", stock[stockKey("rose", "Red Naomi", "60")], 510);
check("пустые партии не идут", stockKey("rose", "Empty", "60") in stock, false);
check("зав. складом Есентая — только хризантема", Object.keys(mainStockMap(batches, "esentai")), [stockKey("chrysanthemum", "Altaj", "Вторая")]);

console.log("\n— Кто грузит фуры и кто их заказывает —");
check("грузит зав. складом и администратор", ["warehouse", "admin", "manager", "sales_head", "accountant", "", undefined].map((r) => canLoadTrucks(r)), [true, true, false, false, false, false, false]);
check("менеджер города заказывает фуру (и без флага главного)", regionAccess({ role: "manager", store: "astana", director: false }, "astana").order, true);
check("…но деньги города видит только главный", [regionAccess({ role: "manager", store: "astana", director: false }, "astana").money, regionAccess({ role: "manager", store: "astana", director: true }, "astana").money], [false, true]);
check("менеджер Астаны в Караганду не заказывает", regionAccess({ role: "manager", store: "astana", director: true }, "karaganda").order, false);
check("менеджер без города фуру не заказывает", regionAccess({ role: "manager", store: "" }, "astana").order, false);
check("зав. складом смотрит город, но фуру не заказывает", [regionAccess({ role: "warehouse" }, "astana").view, regionAccess({ role: "warehouse" }, "astana").order], [true, false]);

console.log("\n— Менеджер города продаёт только со склада города —");
check("менеджер Астаны: склад — Астана, что бы ни прислала форма", newOrderStore({ role: "manager", seatStore: "astana", requested: "" }), { store: "astana", refusal: "" });
check("…даже если просит основной", newOrderStore({ role: "manager", seatStore: "astana", requested: "office" }).store, "astana");
check("…и чужой город", newOrderStore({ role: "manager", seatStore: "astana", requested: "karaganda" }).store, "astana");
check("менеджер без города со склада города не продаёт", has(newOrderStore({ role: "manager", seatStore: "", requested: "astana" }).refusal, "продаёт менеджер этого города"), true);
check("…а с основного — как раньше", newOrderStore({ role: "manager", seatStore: "", requested: "" }), { store: "", refusal: "" });
check("администратор и РОП — любой склад", [newOrderStore({ role: "admin", requested: "semey" }).store, newOrderStore({ role: "sales_head", requested: "astana" }).store], ["semey", "astana"]);
check("зав. складом склад заявки не выбирает", newOrderStore({ role: "warehouse", requested: "astana" }), { store: "", refusal: "" });
const cityOrder = { status: "confirmed", kind: "", retail: "", store: "astana", items: [{ shippedQuantity: 0 }] };
check("менеджер города не переносит заявку на основной склад", has(storeChangeRefusal({ role: "manager", isOwner: true, actorStore: "astana", order: cityOrder, to: "" }), "только со склада своего города"), true);
check("менеджер без города не переносит заявку на склад города", has(storeChangeRefusal({ role: "manager", isOwner: true, actorStore: "", order: { ...cityOrder, store: "" }, to: "astana" }), "продаёт менеджер этого города"), true);
check("администратор переносит", storeChangeRefusal({ role: "admin", isOwner: false, order: cityOrder, to: "" }), "");

console.log("\n— Остатки по городам (владельцу) —");
const cityBatches = [
  { flowerType: "rose", variety: "Red Naomi", grade: "60", quantityRemaining: 500, store: "" },
  { flowerType: "rose", variety: "Red Naomi", grade: "60", quantityRemaining: 120, store: "astana" },
  { flowerType: "rose", variety: "red naomi", grade: "60", quantityRemaining: 30, store: "astana" },
  { flowerType: "rose", variety: "Red Naomi", grade: "60", quantityRemaining: 70, store: "semey" },
  { flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantityRemaining: 900, store: "" },
  { flowerType: "eustoma", variety: "Rosita White", grade: "Стандарт", quantityRemaining: 40, store: "office" },
  { flowerType: "rose", variety: "Sold", grade: "60", quantityRemaining: 0, store: "astana" },
];
const transit = [{ store: "karaganda" as const, flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 300 }];
const m = cityStockMatrix({ batches: cityBatches, transit });
check("строки — только то, что лежит или едет в города", m.map((r) => `${r.variety}:${r.main}`), ["Red Naomi:500", "Altaj:900"]);
check("город: партии одного сорта складываются", m[0].cities, { astana: 150, semey: 70 });
check("в пути — отдельно от лежащего", m[1].transit, { karaganda: 300 });
check("офис — не город", m.some((r) => r.variety === "Rosita White"), false);
check("с производством — ещё и то, что есть только там… но офис всё равно не город", cityStockMatrix({ batches: cityBatches, transit: [], withMain: true }).map((r) => r.variety), ["Red Naomi", "Altaj"]);
check("без городов и пути таблица пуста", cityStockMatrix({ batches: cityBatches.filter((b) => !b.store), transit: [] }), []);

console.log("\n— Чего не хватает городу под заявки клиентов —");
const need = cityShortage({
  store: "astana",
  orders: [
    { status: "confirmed", store: "astana", items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 300, shippedQuantity: 0 }, { flowerType: "rose", variety: "Jumilia", grade: "50", quantity: 100, shippedQuantity: 100 }] },
    { status: "cancelled", store: "astana", items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 999, shippedQuantity: 0 }] },
    { status: "confirmed", store: "semey", items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 999, shippedQuantity: 0 }] },
    { status: "confirmed", store: "astana", kind: "region", items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 999, shippedQuantity: 0 }] },
  ],
  cityStock: { [stockKey("rose", "Red Naomi", "60")]: 150 },
  coming: { [stockKey("rose", "Red Naomi", "60")]: 50 },
});
check("заявки клиентов 300 − на складе 150 − едет 50 = 100; отменённые, чужой город и сама фура не в счёт", need, { [stockKey("rose", "Red Naomi", "60")]: 100 });
check("хватает — пусто", cityShortage({ store: "astana", orders: [{ status: "confirmed", store: "astana", items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 100, shippedQuantity: 0 }] }], cityStock: { [stockKey("rose", "Red Naomi", "60")]: 100 }, coming: {} }), {});

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
