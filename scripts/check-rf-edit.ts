/*
 * Отгрузки в РФ: правка и отмена (16.11.2026, владелец: «дай возможность видеть её, редактировать и прочее»).
 *
 * Стережём обе стороны: пропустим лишнее — зав. складом поправит чужой цветок, количество вырастет «из воздуха» (со
 * склада ничего не спишется) или рублёвая отгрузка останется без цены и клиента; откажем зря — ошибку в цене нельзя
 * будет исправить, как и было. И про склад: уменьшенное количество обязано вернуться в партии, а не исчезнуть.
 *
 * Запуск: npx tsx scripts/check-rf-edit.ts
 */
import { isRfShipment, planRfCancel, planRfEdit, rfEditRefusal, rfSummary, type RfEditPlan, type RfOrder } from "../src/lib/rfEdit";
import { rubComment, rubNote, type RubBatch } from "../src/lib/rubShipment";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const has = (text: unknown, part: string) => typeof text === "string" && text.includes(part);
const plan = (p: RfEditPlan | string): RfEditPlan => {
  if (typeof p === "string") throw new Error(`ждали план, получили отказ: ${p}`);
  return p;
};

const batches = new Map<string, RubBatch>([
  ["B1", { batchId: "B1", flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantityRemaining: 3000, store: "" }],
  ["B2", { batchId: "B2", flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantityRemaining: 500, store: "" }],
  ["B3", { batchId: "B3", flowerType: "rose", variety: "Jumilia", grade: "60", quantityRemaining: 300, store: "" }],
]);
// Живой случай: № SALMN — Диана, 10 000 шт. Altaj Вторая по 5 ₽ (похоже на опечатку в цене).
const order: RfOrder = {
  status: "shipped",
  kind: "region",
  direction: "РФ",
  clientId: "C1",
  clientName: "Сабина Междуречинск",
  paidAmount: 0,
  deliveryDate: "2026-11-14",
  notes: rubNote(50000, "машина Сергея"),
  items: [{ itemId: "O-I1", flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 10000, shippedQuantity: 10000, priceRub: 5 }],
};
const old: RfOrder = {
  ...order,
  clientId: "",
  clientName: "РФ",
  notes: "",
  items: [
    { itemId: "O-I1", flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 870, shippedQuantity: 870 },
    { itemId: "O-I2", flowerType: "eustoma", variety: "Alissa Pink", grade: "Стандарт", quantity: 750, shippedQuantity: 750 },
  ],
};
const same = { deliveryDate: "2026-11-14", clientId: "C1", comment: "машина Сергея", items: [{ itemId: "O-I1", quantity: 10000, priceRub: 5 }], add: [] };
const base = { order, client: null, role: "warehouse", farm: "esentai", batches, today: "2026-11-16" };
const card = { clientId: "C2", name: "Цветы Сибири", phone: "+7 900 000 00 00", active: true, retail: "" };

console.log("— Что считается отгрузкой в РФ —");
check("регион + РФ", isRfShipment(order), true);
check("регион + Астана — нет", isRfShipment({ kind: "region", direction: "Астана" }), false);
check("клиентская заявка в РФ — нет", isRfShipment({ kind: "", direction: "РФ" }), false);

console.log("— Кто правит —");
check("зав. складом, свой цветок", rfEditRefusal(order, "warehouse", "esentai"), "");
check("зав. складом, чужой цветок", has(rfEditRefusal(order, "warehouse", "rose_farm"), "другого производства"), true);
check("зав. складом без производства", has(rfEditRefusal(order, "warehouse", ""), "не указано производство"), true);
check("РОП", rfEditRefusal(order, "sales_head", null), "");
check("администратор", rfEditRefusal(order, "admin", null), "");
check("менеджер — нет", has(rfEditRefusal(order, "manager", null), "правит зав. складом"), true);
check("бухгалтер — нет", has(rfEditRefusal(order, "accountant", null), "правит зав. складом"), true);
check("отменённую — никто", has(rfEditRefusal({ ...order, status: "cancelled" }, "admin", null), "отменена"), true);
check("поступления вписаны — склад уже не правит", has(rfEditRefusal({ ...order, paidAmount: 100 }, "warehouse", "esentai"), "администратор"), true);
check("поступления вписаны — администратор правит", rfEditRefusal({ ...order, paidAmount: 100 }, "admin", null), "");
check("не отгрузка в РФ", rfEditRefusal({ ...order, direction: "Астана" }, "admin", null), "Это не отгрузка в РФ");

console.log("— Правка цены, дня, клиента, комментария —");
const nothing = plan(planRfEdit({ ...base, edit: same }));
check("ничего не меняли — пусто", nothing.describe, []);
check("ничего не меняли — заметка та же", nothing.notes, order.notes);
const price = plan(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 10000, priceRub: 50 }] } }));
check("цена 5 → 50: сумма", [price.rubBefore, price.rubAfter], [50000, 500000]);
check("цена: склад не трогается", [price.backToStock, price.added, price.newStatus], [0, 0, "shipped"]);
check("цена: заметка пересчитана, комментарий цел", [has(price.notes, "500"), rubComment(price.notes)], [true, "машина Сергея"]);
check("цена: в журнал", price.describe.some((d) => d.includes("цена") && d.includes("50")), true);
const day = plan(planRfEdit({ ...base, edit: { ...same, deliveryDate: "2026-11-13", comment: "" } }));
check("день и комментарий", [day.deliveryDate, rubComment(day.notes), day.describe.length], ["2026-11-13", "", 2]);
check("день в будущем — нельзя", has(planRfEdit({ ...base, edit: { ...same, deliveryDate: "2026-11-20" } }), "не может быть в будущем"), true);
check("кривая дата", planRfEdit({ ...base, edit: { ...same, deliveryDate: "2026-02-31" } }), "Укажите дату отгрузки");
const other = plan(planRfEdit({ ...base, client: card, edit: { ...same, clientId: "C2" } }));
check("другой клиент", [other.client?.name, other.describe[0]], ["Цветы Сибири", "клиент: Сабина Междуречинск → Цветы Сибири"]);
check("клиент выключен", has(planRfEdit({ ...base, client: { ...card, active: false }, edit: { ...same, clientId: "C2" } }), "выключена"), true);
check("наш магазин — не клиент", has(planRfEdit({ ...base, client: { ...card, retail: "almaty" }, edit: { ...same, clientId: "C2" } }), "наш магазин"), true);
check("клиент не нашёлся", has(planRfEdit({ ...base, client: null, edit: { ...same, clientId: "C9" } }), "не найден"), true);
check("убрать клиента нельзя", planRfEdit({ ...base, edit: { ...same, clientId: "" } }), "Выберите клиента из базы");

console.log("— Количество —");
const less = plan(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 8000, priceRub: 5 }] } }));
check("меньше: 2 000 возвращаются на склад", [less.lines[0].quantity, less.lines[0].shipped, less.backToStock, less.newStatus], [8000, 8000, 2000, "shipped"]);
check("меньше: сумма", less.rubAfter, 40000);
check("больше цифрой — нельзя", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 10001, priceRub: 5 }] } }), "выберите партию"), true);
check("дробное", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 99.5, priceRub: 5 }] } }), "целым числом"), true);
check("минус", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: -1, priceRub: 5 }] } }), "укажите количество"), true);
check("цена-опечатка", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 10000, priceRub: 500000 }] } }), "опечатку"), true);
check("цену стереть нельзя", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 10000, priceRub: 0 }] } }), "укажите цену в рублях"), true);
check("чужая позиция", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "X-I9", quantity: 1, priceRub: 5 }] } }), "не из этой отгрузки"), true);
check("позицию не прислали", has(planRfEdit({ ...base, edit: { ...same, items: [] } }), "обновите страницу"), true);
check("позиция дважды", has(planRfEdit({ ...base, edit: { ...same, items: [same.items[0], same.items[0]] } }), "дважды"), true);
check("убрать всё — это отмена", has(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 0, priceRub: 5 }] } }), "Отменить отгрузку"), true);

console.log("— Добавить из партий —");
const more = plan(planRfEdit({ ...base, edit: { ...same, add: [{ batchId: "B1", quantity: 500, priceRub: 5 }] } }));
check("тот же сорт по той же цене — в ту же позицию", [more.more, more.created.length, more.added], [[{ itemId: "O-I1", quantity: 500, parts: [{ batchId: "B1", quantity: 500 }] }], 0, 500]);
check("сумма с дописанным", more.rubAfter, 52500);
const fresh = plan(planRfEdit({ ...base, edit: { ...same, add: [{ batchId: "B1", quantity: 500, priceRub: 7 }, { batchId: "B2", quantity: 100, priceRub: 4 }] } }));
check("другая цена и другой сорт — новые позиции", [fresh.more.length, fresh.created.map((c) => `${c.grade} ${c.quantity} ${c.priceRub}`)], [0, ["Вторая 500 7", "Третья 100 4"]]);
check("больше, чем в партии", has(planRfEdit({ ...base, edit: { ...same, add: [{ batchId: "B2", quantity: 501, priceRub: 4 }] } }), "в партии осталось 500"), true);
check("чужой цветок складу нельзя", has(planRfEdit({ ...base, edit: { ...same, add: [{ batchId: "B3", quantity: 10, priceRub: 90 }] } }), "их зав. складом"), true);
check("добавка без цены", has(planRfEdit({ ...base, edit: { ...same, add: [{ batchId: "B1", quantity: 10, priceRub: 0 }] } }), "укажите цену в рублях"), true);
const swap = plan(planRfEdit({ ...base, edit: { ...same, items: [{ itemId: "O-I1", quantity: 0, priceRub: 5 }], add: [{ batchId: "B2", quantity: 400, priceRub: 4 }] } }));
check("убрали одну, добавили другую", [swap.lines[0].remove, swap.backToStock, swap.created.length, swap.rubAfter, swap.newStatus], [true, 10000, 1, 1600, "shipped"]);

console.log("— Старый «объём на РФ» без цен и клиента —");
const admin = { ...base, role: "admin", farm: null, order: old };
const oldSame = { deliveryDate: "2026-11-14", clientId: "", comment: "", items: [{ itemId: "O-I1", quantity: 870, priceRub: 0 }, { itemId: "O-I2", quantity: 750, priceRub: 0 }], add: [] };
check("без цен и клиента править можно", plan(planRfEdit({ ...admin, edit: { ...oldSame, deliveryDate: "2026-11-13" } })).describe.length, 1);
check("цены — всем позициям сразу", has(planRfEdit({ ...admin, client: card, edit: { ...oldSame, clientId: "C2", items: [{ itemId: "O-I1", quantity: 870, priceRub: 90 }, { itemId: "O-I2", quantity: 750, priceRub: 0 }] } }), "укажите цену в рублях"), true);
check("цены без клиента — нельзя", has(planRfEdit({ ...admin, edit: { ...oldSame, items: [{ itemId: "O-I1", quantity: 870, priceRub: 90 }, { itemId: "O-I2", quantity: 750, priceRub: 60 }] } }), "должен быть клиент"), true);
const priced = plan(planRfEdit({ ...admin, client: card, edit: { ...oldSame, clientId: "C2", items: [{ itemId: "O-I1", quantity: 870, priceRub: 90 }, { itemId: "O-I2", quantity: 750, priceRub: 60 }] } }));
check("дописали клиента и цены", [priced.client?.clientId, priced.rubAfter, has(priced.notes, "Отгрузка в РФ, цены в рублях")], ["C2", 123300, true]);
check("смешанную отгрузку зав. складом не правит", has(planRfEdit({ ...admin, role: "warehouse", farm: "rose_farm", order: { ...old, items: [...old.items, order.items[0]] }, edit: oldSame }), "другого производства"), true);

console.log("— Отмена —");
const cancel = planRfCancel({ order, role: "warehouse", farm: "esentai", reason: "машина не пришла" });
check("отмена: всё возвращается", typeof cancel === "string" ? cancel : [cancel.backToStock, cancel.lines.length], [10000, 1]);
check("без причины", has(planRfCancel({ order, role: "admin", farm: null, reason: "нет" }), "причину"), true);
check("с поступлениями — никому", has(planRfCancel({ order: { ...order, paidAmount: 5 }, role: "admin", farm: null, reason: "машина не пришла" }), "бухгалтер убирает сумму"), true);
check("менеджеру нельзя", has(planRfCancel({ order, role: "manager", farm: null, reason: "машина не пришла" }), "правит зав. складом"), true);

console.log("— Сводка и комментарий —");
check("сводка", rfSummary([order, old, { ...order, status: "cancelled" }]), { count: 2, stems: 11620, rub: 50000, income: 0, noPrices: 1 });
check("комментарий без служебного начала", rubComment(rubNote(1234.5, "кто забрал")), "кто забрал");
check("чужой комментарий не трогаем", rubComment("просто текст"), "просто текст");

if (fails > 0) {
  console.error(`\nНе прошло проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки пройдены");
