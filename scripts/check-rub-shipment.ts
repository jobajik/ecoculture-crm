/*
 * Отгрузка в РФ с ценами в рублях — заявка, которую заводит зав. складом (13.11.2026).
 *
 * Стережём обе стороны: пропустим лишнее — склад спишет чужой цветок или больше, чем есть в партии; откажем зря —
 * зав. складом не сможет записать то, что реально уехало. И главное про деньги: рубли НЕ должны попасть в тенговую
 * выручку — цена в тенге у таких позиций ноль, заявка остаётся «не продажей».
 *
 * Запуск: npx tsx scripts/check-rub-shipment.ts
 */
import { ORDER_KINDS } from "../src/lib/constants";
import { hasNoClientInvoice, isNotASale, isRegionOrder } from "../src/lib/orderKind";
import { buildNewOrder, toOrderItem } from "../src/lib/repo/orders";
import { RUB_DIRECTION, cleanRub, formatRub, hasRubPrices, planRubItems, rubShipmentRefusal, rubTotal, type RubBatch } from "../src/lib/rubShipment";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const starts = (text: string, prefix: string) => (text.startsWith(prefix) ? prefix : text);

const batches = new Map<string, RubBatch>([
  ["B1", { batchId: "B1", flowerType: "rose", variety: "Jumilia", grade: "60", quantityRemaining: 300, store: "" }],
  ["B2", { batchId: "B2", flowerType: "rose", variety: "Jumilia", grade: "60", quantityRemaining: 100, store: "" }],
  ["B3", { batchId: "B3", flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantityRemaining: 500, store: "" }],
  ["B4", { batchId: "B4", flowerType: "rose", variety: "Jana", grade: "50", quantityRemaining: 80, store: "office" }],
]);
const client = { active: true, retail: "" };
const base = { role: "warehouse", farm: "rose_farm", client, deliveryDate: "2026-11-13", today: "2026-11-13", batches };
const ok = [{ batchId: "B1", quantity: 200, priceRub: 85 }];

console.log("— Кто и что может —");
check("зав. складом, свой цветок", rubShipmentRefusal({ ...base, lines: ok }), "");
check("администратор — любой цветок", rubShipmentRefusal({ ...base, role: "admin", farm: null, lines: [{ batchId: "B3", quantity: 10, priceRub: 40 }] }), "");
check("менеджеру нельзя", starts(rubShipmentRefusal({ ...base, role: "manager", lines: ok }), "Отгрузку в РФ оформляет"), "Отгрузку в РФ оформляет");
check("бухгалтеру нельзя", starts(rubShipmentRefusal({ ...base, role: "accountant", lines: ok }), "Отгрузку в РФ оформляет"), "Отгрузку в РФ оформляет");
check("склад без производства", starts(rubShipmentRefusal({ ...base, farm: "", lines: ok }), "У вас не указано производство"), "У вас не указано производство");
check("чужой цветок складу нельзя", rubShipmentRefusal({ ...base, lines: [{ batchId: "B3", quantity: 10, priceRub: 40 }] }).includes("их зав. складом"), true);
check("партия офиса — нельзя", rubShipmentRefusal({ ...base, lines: [{ batchId: "B4", quantity: 10, priceRub: 40 }] }).includes("не на основном складе"), true);

console.log("\n— Клиент и дата —");
check("без клиента", rubShipmentRefusal({ ...base, client: null, lines: ok }), "Выберите клиента из базы");
check("выключенная карточка", starts(rubShipmentRefusal({ ...base, client: { active: false }, lines: ok }), "Карточка этого клиента выключена"), "Карточка этого клиента выключена");
check("наш магазин — не покупатель", starts(rubShipmentRefusal({ ...base, client: { active: true, retail: "almaty" }, lines: ok }), "Это наш магазин"), "Это наш магазин");
check("дата в будущем — нельзя: отгрузка по факту", starts(rubShipmentRefusal({ ...base, deliveryDate: "2026-11-14", lines: ok }), "Отгрузка записывается по факту"), "Отгрузка записывается по факту");
check("вчерашняя — можно", rubShipmentRefusal({ ...base, deliveryDate: "2026-11-12", lines: ok }), "");
check("пустая дата", rubShipmentRefusal({ ...base, deliveryDate: "", lines: ok }), "Укажите дату отгрузки");

console.log("\n— Количество и цена —");
check("нет строк", rubShipmentRefusal({ ...base, lines: [] }), "Добавьте хотя бы одну партию");
check("больше, чем в партии", rubShipmentRefusal({ ...base, lines: [{ batchId: "B2", quantity: 101, priceRub: 85 }] }).includes("осталось 100 шт., а отмечено 101"), true);
check("одна партия двумя строками — считаем вместе", rubShipmentRefusal({ ...base, lines: [{ batchId: "B2", quantity: 60, priceRub: 85 }, { batchId: "B2", quantity: 60, priceRub: 90 }] }).includes("отмечено 120"), true);
check("ровно остаток — можно", rubShipmentRefusal({ ...base, lines: [{ batchId: "B2", quantity: 100, priceRub: 85 }] }), "");
check("дробное количество", rubShipmentRefusal({ ...base, lines: [{ batchId: "B1", quantity: 10.5, priceRub: 85 }] }).includes("целым числом"), true);
check("ноль штук", rubShipmentRefusal({ ...base, lines: [{ batchId: "B1", quantity: 0, priceRub: 85 }] }).includes("укажите количество"), true);
check("без цены", rubShipmentRefusal({ ...base, lines: [{ batchId: "B1", quantity: 10, priceRub: 0 }] }).includes("укажите цену в рублях"), true);
check("цена с копейками — можно", rubShipmentRefusal({ ...base, lines: [{ batchId: "B1", quantity: 10, priceRub: 84.5 }] }), "");
check("цена-опечатка", rubShipmentRefusal({ ...base, lines: [{ batchId: "B1", quantity: 10, priceRub: 850000 }] }).includes("похоже на опечатку"), true);
check("партии уже нет", starts(rubShipmentRefusal({ ...base, lines: [{ batchId: "NOPE", quantity: 10, priceRub: 85 }] }), "Одной из партий уже нет"), "Одной из партий уже нет");

console.log("\n— Строки формы → позиции заявки —");
const plan = planRubItems(
  [
    { batchId: "B1", quantity: 200, priceRub: 85 },
    { batchId: "B2", quantity: 100, priceRub: 85 },
    { batchId: "B1", quantity: 50, priceRub: 90 },
    { batchId: "B1", quantity: 20, priceRub: 85 },
  ],
  batches
);
check("один сорт и одна цена из двух партий — одна позиция", plan.map((i) => [i.variety, i.grade, i.priceRub, i.quantity, i.parts.length]), [["Jumilia", "60", 85, 320, 2], ["Jumilia", "60", 90, 50, 1]]);
check("партия дважды в позиции складывается", plan[0].parts, [{ batchId: "B1", quantity: 220 }, { batchId: "B2", quantity: 100 }]);
check("сумма в рублях", rubTotal(plan), 320 * 85 + 50 * 90);
check("копейки не теряются", [cleanRub(84.555), rubTotal([{ quantity: 3, priceRub: 84.5 }])], [84.56, 253.5]);
check("вид суммы", [formatRub(31700), formatRub(253.5)].map((s) => s.replace(/\s/g, " ")), ["31 700 ₽", "253,50 ₽"]);

console.log("\n— Рубли не идут в тенговые деньги —");
const built = buildNewOrder(
  { managerEmail: "w@x.kz", kind: ORDER_KINDS.REGION, direction: RUB_DIRECTION, clientId: "C1", clientName: "Клиент РФ", clientPhone: "", deliveryDate: "2026-11-13", confirmed: true,
    items: plan.map((i) => ({ flowerType: i.flowerType as "rose", variety: i.variety, grade: i.grade, quantity: i.quantity, unitPrice: 0, priceRub: i.priceRub })) },
  "ORD-T", "2026-11-13T10:00:00.000Z"
);
check("цена в тенге — ноль, рубли — в своей колонке", built.itemRecords.map((r) => [r.UnitPrice, r.PriceRub]), [[0, 85], [0, 90]]);
check("клиент записан, направление РФ, вид — регион", [built.orderRecord.ClientID, built.orderRecord.Direction, built.orderRecord.Kind], ["C1", "РФ", "region"]);
const order = { kind: String(built.orderRecord.Kind), direction: "РФ", retail: "", clientName: "Клиент РФ" };
check("не продажа: ни счёта Kaspi, ни долга, ни рейтинга", [isRegionOrder(order), hasNoClientInvoice(order), isNotASale(order)], [true, true, true]);
const read = built.itemRecords.map((r) => toOrderItem(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))));
check("позиция читается обратно с рублями", read.map((i) => [i.unitPrice, i.priceRub]), [[0, 85], [0, 90]]);
check("рублёвая цена с запятой из таблицы", toOrderItem({ OrderID: "o", ItemID: "i", FlowerType: "rose", Variety: "v", Grade: "60", Quantity: "10", UnitPrice: "0", ShippedQuantity: "10", PriceRub: "84,5" }).priceRub, 84.5);
check("обычная позиция — без рублей", "priceRub" in toOrderItem({ OrderID: "o", ItemID: "i", FlowerType: "rose", Variety: "v", Grade: "60", Quantity: "10", UnitPrice: "300", ShippedQuantity: "0", PriceRub: "" }), false);
check("узнаём рублёвую заявку по позициям", [hasRubPrices({ items: read }), hasRubPrices({ items: [{ priceRub: 0 }, {}] }), hasRubPrices(null)], [true, false, false]);

console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : "\nВсе проверки прошли.");
process.exit(fails ? 1 : 0);
