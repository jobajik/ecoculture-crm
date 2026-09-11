/*
 * Правка уже оформленной заявки.
 *
 * До неё поправить заявку было нельзя вовсе: забыл дату доставки, ошибся в
 * количестве — и оставалось либо отменить и завести заново (в базе копятся
 * заявки-двойники), либо править Google-таблицу руками, в обход всех проверок.
 * Правка закрывает эту дыру, но открывает четыре новых, и все четыре — про
 * деньги и склад.
 *
 * Первое: **правка не должна становиться вторым путём к деньгам.** Сумму
 * оплаченной заявки меняет бухгалтер через рекламацию — там есть причина,
 * пересчёт долга и след в журнале. Разреши менеджеру тихо поменять состав
 * оплаченной заявки — и к тем же деньгам ведут две двери, а объяснить
 * расхождение через месяц будет нечем.
 *
 * Второе: **отгруженное не правится.** Уменьшить заявку ниже отгруженного или
 * удалить отгруженную позицию — значит стереть со склада стебли, которых уже
 * нет, не оставив ни продажи, ни списания.
 *
 * Третье: **правит только тот, кто заявку завёл.** Правило то же, что у
 * подтверждения и отмены, и живёт оно в одной функции на три места
 * (`ownerRoleFor`) — три копии этого выражения разъехались бы.
 *
 * Четвёртое, неочевидное: **номера новых позиций.** Удалили вторую из трёх,
 * добавили новую — и по счёту строк она получила бы номер уже существующей.
 * Две строки с одним ItemID означают отгрузку, ушедшую не в ту позицию.
 *
 * Запуск: npx tsx scripts/check-order-edit.ts
 */
import {
  canEditOrder,
  cleanDeliveryDate,
  describeItemChanges,
  editHeaderRefusal,
  editItemsRefusal,
  editedItemsRefusal,
  editedTotal,
  nextItemIds,
  planItemSave,
  type CurrentItem,
  type EditedItem,
} from "../src/lib/orderEdit";
import { ownerRoleFor } from "../src/lib/orderRules";
import { ORDER_KINDS, ORDER_STATUSES, ROLES } from "../src/lib/constants";

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
function checkSome(label: string, actual: string, expectEmpty: boolean) {
  const ok = expectEmpty ? actual === "" : actual !== "";
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${actual ? `«${actual}»` : "можно"}${
      ok ? "" : ` (ждали ${expectEmpty ? "«можно»" : "отказ"})`
    }`
  );
}

const MINE = "manager@x.kz";

function order(over: Partial<Parameters<typeof editItemsRefusal>[0]> = {}) {
  return {
    status: ORDER_STATUSES.NEW,
    managerEmail: MINE,
    paidAmount: 0,
    items: [{ shippedQuantity: 0 }],
    retail: "",
    kind: "",
    ...over,
  };
}

// --- Кто правит ------------------------------------------------------------

checkSome("свой менеджер правит", editHeaderRefusal(order(), ROLES.MANAGER, MINE), true);
checkSome("админ правит любую", editHeaderRefusal(order(), ROLES.ADMIN, "boss@x.kz"), true);
checkSome("чужая заявка — нет", editHeaderRefusal(order(), ROLES.MANAGER, "other@x.kz"), false);
checkSome("бухгалтер — нет", editHeaderRefusal(order(), ROLES.ACCOUNTANT, MINE), false);
checkSome("зав. складом — нет", editHeaderRefusal(order(), ROLES.WAREHOUSE, MINE), false);
checkSome("пустая роль — нет (грабли 1.10)", editHeaderRefusal(order(), "", MINE), false);

// Правило «кому положено» — одно на подтверждение, отмену и правку.
check("клиентскую заявку правит менеджер", ownerRoleFor({}, ROLES.MANAGER), true);
check("магазинную — менеджер розницы", ownerRoleFor({ retail: "almaty" }, ROLES.RETAIL_ALMATY), true);
check("магазинную — и зав. складом (регионы)", ownerRoleFor({ retail: "regions" }, ROLES.WAREHOUSE), true);
check("городскую — РОП", ownerRoleFor({ kind: ORDER_KINDS.REGION }, ROLES.SALES_HEAD), true);
check("городскую менеджер не правит", ownerRoleFor({ kind: ORDER_KINDS.REGION }, ROLES.MANAGER), false);

// --- До какого момента -----------------------------------------------------

checkSome(
  "отгруженную не правят",
  editHeaderRefusal(order({ status: ORDER_STATUSES.SHIPPED }), ROLES.MANAGER, MINE),
  false
);
checkSome(
  "отменённую не правят",
  editHeaderRefusal(order({ status: ORDER_STATUSES.CANCELLED }), ROLES.MANAGER, MINE),
  false
);

// Шапку правят и после оплаты: перенос доставки — это не деньги.
checkSome(
  "оплаченная: дату править можно",
  editHeaderRefusal(order({ paidAmount: 100_000 }), ROLES.MANAGER, MINE),
  true
);
checkSome(
  "оплаченная: позиции — нельзя",
  editItemsRefusal(order({ paidAmount: 100_000 }), ROLES.MANAGER, MINE),
  false
);
// Копейка не должна запирать заявку, но и не должна её открывать: допуск тот
// же, что у всех денежных сравнений в программе.
checkSome(
  "копейка оплаты заявку не запирает",
  editItemsRefusal(order({ paidAmount: 0.5 }), ROLES.MANAGER, MINE),
  true
);
checkSome(
  "частичная оплата запирает позиции",
  editItemsRefusal(order({ paidAmount: 50_000 }), ROLES.MANAGER, MINE),
  false
);
checkSome(
  "частично отгруженную не правят",
  editItemsRefusal(order({ items: [{ shippedQuantity: 10 }] }), ROLES.MANAGER, MINE),
  false
);
// Заявка в наш магазин денег не видит никогда — её позиции открыты до отгрузки.
checkSome(
  "магазинную правит её менеджер",
  editItemsRefusal(
    order({ retail: "almaty", managerEmail: "shop@x.kz" }),
    ROLES.RETAIL_ALMATY,
    "shop@x.kz"
  ),
  true
);
// У городской заявки в том же поле лежит сумма поступлений от бухгалтера.
const regionPaid = editItemsRefusal(
  order({ kind: ORDER_KINDS.REGION, paidAmount: 400_000, managerEmail: "rop@x.kz" }),
  ROLES.SALES_HEAD,
  "rop@x.kz"
);
checkSome("город с подтверждёнными поступлениями заперт", regionPaid, false);
check("и сказано это словами про поступления", regionPaid.includes("поступления"), true);

check("кнопка правки — по тому же правилу", canEditOrder(order(), ROLES.MANAGER, MINE), true);
check("чужому кнопки нет", canEditOrder(order(), ROLES.MANAGER, "other@x.kz"), false);

// --- Что можно прислать ----------------------------------------------------

const current: CurrentItem[] = [
  {
    itemId: "O1-I1",
    flowerType: "rose",
    variety: "Фридом",
    grade: "60",
    quantity: 1000,
    unitPrice: 250,
    shippedQuantity: 0,
  },
  {
    itemId: "O1-I2",
    flowerType: "chrysanthemum",
    variety: "Балтика",
    grade: "Высшая",
    quantity: 500,
    unitPrice: 300,
    shippedQuantity: 0,
  },
];

const keepBoth: EditedItem[] = current.map((i) => ({
  itemId: i.itemId,
  flowerType: i.flowerType,
  variety: i.variety,
  grade: i.grade,
  quantity: i.quantity,
  unitPrice: i.unitPrice,
}));

const ok = (next: EditedItem[], region = false) =>
  editedItemsRefusal({ current, next, region });

checkSome("состав без изменений проходит", ok(keepBoth), true);
checkSome("пустой состав — отказ", ok([]), false);
checkSome(
  "чужая позиция — отказ",
  ok([{ ...keepBoth[0], itemId: "OTHER-I1" }]),
  false
);
checkSome(
  "одна и та же позиция дважды — отказ",
  ok([keepBoth[0], { ...keepBoth[0] }]),
  false
);
checkSome("ноль стеблей — отказ", ok([{ ...keepBoth[0], quantity: 0 }]), false);
checkSome("минус — отказ", ok([{ ...keepBoth[0], quantity: -100 }]), false);
checkSome("дробные стебли — отказ", ok([{ ...keepBoth[0], quantity: 10.5 }]), false);
checkSome("отрицательная цена — отказ", ok([{ ...keepBoth[0], unitPrice: -1 }]), false);
checkSome("пустой сорт — отказ", ok([{ ...keepBoth[0], variety: "  " }]), false);
checkSome(
  "выдуманная длина — отказ (список закрытый)",
  ok([{ ...keepBoth[0], grade: "шестьдесят" }]),
  false
);
checkSome("новая позиция без itemId — можно", ok([...keepBoth, { itemId: "", flowerType: "rose", variety: "Атена", grade: "50", quantity: 200, unitPrice: 200 }]), true);
checkSome("убрать позицию, по которой ничего не уехало, — можно", ok([keepBoth[0]]), true);
// У городской заявки цены нет: ноль там — не ошибка, а её природа.
checkSome(
  "город: нулевая цена не мешает",
  ok(keepBoth.map((i) => ({ ...i, unitPrice: 0 })), true),
  true
);

// Отгруженное — отдельно: этот запрет дублирует общий, и намеренно.
const shipped: CurrentItem[] = [{ ...current[0], shippedQuantity: 400 }, current[1]];
checkSome(
  "ниже отгруженного опустить нельзя",
  editedItemsRefusal({
    current: shipped,
    next: [{ ...keepBoth[0], quantity: 300 }, keepBoth[1]],
    region: false,
  }),
  false
);
checkSome(
  "отгруженную позицию удалить нельзя",
  editedItemsRefusal({ current: shipped, next: [keepBoth[1]], region: false }),
  false
);
checkSome(
  "ровно до отгруженного — можно",
  editedItemsRefusal({
    current: shipped,
    next: [{ ...keepBoth[0], quantity: 400 }, keepBoth[1]],
    region: false,
  }),
  true
);
// Старая заявка с градацией не из списка: оставить как было можно, ввести
// такую же новую — нет. Иначе правка даты ломалась бы об чужую строку.
const legacy: CurrentItem[] = [{ ...current[0], grade: "60 см" }];
checkSome(
  "старую незнакомую градацию можно оставить",
  editedItemsRefusal({
    current: legacy,
    next: [{ ...keepBoth[0], grade: "60 см" }],
    region: false,
  }),
  true
);

// --- Что попадёт в журнал --------------------------------------------------

const changed: EditedItem[] = [
  { ...keepBoth[0], quantity: 1200 },
  { itemId: "", flowerType: "rose", variety: "Атена", grade: "50", quantity: 200, unitPrice: 200 },
];
const описание = describeItemChanges({ current, next: changed, region: false });
check("изменение количества описано", описание[0], "Фридом 60 см: 1000 → 1200 шт");
check("добавленное описано", описание[1], "добавлено: Атена 50 см — 200 шт. по 200 ₸");
check("убранное описано", описание[2], "убрано: Балтика Высшая — 500 шт.");
check("без изменений журнал пуст", describeItemChanges({ current, next: keepBoth, region: false }), []);

check("сумма нового состава", editedTotal(changed, false), 1200 * 250 + 200 * 200);
check("у города суммы нет", editedTotal(changed, true), 0);

// --- Номера новых позиций --------------------------------------------------

check("продолжаем с наибольшего", nextItemIds("ORD-1", ["ORD-1-I1", "ORD-1-I3"], 2), [
  "ORD-1-I4",
  "ORD-1-I5",
]);
check("пустая заявка начинает с первого", nextItemIds("ORD-1", [], 1), ["ORD-1-I1"]);
check("чужой формат номера не ломает", nextItemIds("ORD-1", ["ЧТО-ТО"], 1), ["ORD-1-I1"]);

// Здесь я уже ошибся: список «оставить» собирался только из присланных номеров,
// а номер новой позиции выдаётся при записи — и удаление, идущее следом, сносило
// строку сразу после добавления. На живой базе это выглядело бы как «добавил
// позицию, сохранил, её нет».
const plan = planItemSave("ORD-1", ["ORD-1-I1", "ORD-1-I2"], [
  { itemId: "ORD-1-I1" },
  { itemId: "" },
]);
check("новая позиция получает свободный номер", plan.newIds, ["ORD-1-I3"]);
check("и попадает в «оставить»", plan.keep.includes("ORD-1-I3"), true);
check("убранная — в удаление", plan.deleted, ["ORD-1-I2"]);
check(
  "состав без правок ничего не удаляет",
  planItemSave("ORD-1", ["ORD-1-I1"], [{ itemId: "ORD-1-I1" }]).deleted,
  []
);

// --- Дата доставки ---------------------------------------------------------

check("обычная дата", cleanDeliveryDate("2026-09-15"), "2026-09-15");
check("пустая допустима — её и приходят дописывать", cleanDeliveryDate(""), "");
check("мусор отбрасывается", cleanDeliveryDate("завтра"), "");
check("чужой формат отбрасывается", cleanDeliveryDate("15.09.2026"), "");
check("несуществующий день отбрасывается", cleanDeliveryDate("2026-02-31"), "");
check("древняя дата отбрасывается", cleanDeliveryDate("1899-12-30"), "");

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
