/*
 * Склад отгрузки хризантемы: Есентай ⇄ Rose Farm (17.11.2026, владелец: «дай возможность зав. складам менять склад»).
 *
 * Стережём обе стороны: пропустим лишнее — зав. складом переведёт чужой цветок, уже отгруженное или заявку со счётом
 * Kaspi, который ещё ждёт оплаты (клиент заплатит не ту сумму не той компании); откажем зря — склад снова будет
 * просить программиста. И про деньги: общая сумма «получено» не должна меняться, а журнал платежей — расходиться с итогом.
 *
 * Запуск: npx tsx scripts/check-farm-switch.ts
 */
import { planFarmSwitch, switchableItems, switchTarget, type FarmSwitchPlan, type SwitchOrder } from "../src/lib/farmSwitch";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const has = (v: unknown, part: string) => typeof v === "string" && v.includes(part);
const plan = (p: FarmSwitchPlan | string): FarmSwitchPlan => {
  if (typeof p === "string") throw new Error(`ждали план, получили отказ: ${p}`);
  return p;
};
const item = (n: number, flowerType: string, variety: string, grade: string, quantity: number, unitPrice: number, shippedQuantity = 0) => ({
  itemId: `O-I${n}`,
  flowerType,
  variety,
  grade,
  quantity,
  unitPrice,
  shippedQuantity,
});

// Живой случай 1: №3JA79 — одна позиция, оплачена на кассу Есентая.
const one: SwitchOrder = { status: "new", paidAmount: 20000, paidRoseFarm: 0, paidEsentai: 20000, items: [item(1, "chrysanthemum", "Altaj", "Вторая", 50, 400)] };
const oneLedger = [{ paymentId: "P1", amount: 20000, farm: "", flowerType: "chrysanthemum" }];
// Живой случай 2: №JKDK8 — две позиции из четырёх, оплата 51 500 из 51 700.
const mix: SwitchOrder = {
  status: "new",
  paidAmount: 51500,
  paidRoseFarm: 0,
  paidEsentai: 51500,
  items: [
    item(2, "chrysanthemum", "Podolsk Yellow", "Третья", 25, 220),
    item(3, "chrysanthemum", "Pastella", "Третья", 25, 220),
    item(4, "chrysanthemum", "Altaj", "Вторая", 50, 400),
    item(5, "chrysanthemum", "Altaj", "Четвёртая", 115, 180),
  ],
};
const mixLedger = [{ paymentId: "P1", amount: 51500, farm: "", flowerType: "chrysanthemum" }];
const base = { role: "warehouse", farm: "esentai", openInvoiceFarms: [] as string[] };

console.log("— Что вообще переводится —");
check("хризантема Есентая → Rose Farm", switchTarget("chrysanthemum"), "chrysanthemum_rf");
check("хризантема Rose Farm → Есентай", switchTarget("chrysanthemum_rf"), "chrysanthemum");
check("у розы второго склада нет", switchTarget("rose"), "");

console.log("— Кто и что —");
check("зав. складом Есентая видит свои позиции", switchableItems(mix, "warehouse", "esentai").length, 4);
check("зав. складом Rose Farm чужих не видит", switchableItems(mix, "warehouse", "rose_farm").length, 0);
check("администратор видит все", switchableItems(mix, "admin", null).length, 4);
check("менеджеру блок не показывается", switchableItems(mix, "manager", null).length, 0);
check("отгруженная позиция не предлагается", switchableItems({ ...one, items: [item(1, "chrysanthemum", "Altaj", "Вторая", 50, 400, 10)] }, "admin", null).length, 0);
check("отменённая заявка", switchableItems({ ...one, status: "cancelled" }, "admin", null).length, 0);
check("объём на город — зав. складом не предлагается", switchableItems({ ...one, kind: "region" }, "warehouse", "esentai").length, 0);
check("менеджеру нельзя", has(planFarmSwitch({ ...base, role: "manager", farm: null, order: one, itemIds: ["O-I1"], ledger: oneLedger }), "меняет зав. складом"), true);
check("бухгалтеру нельзя", has(planFarmSwitch({ ...base, role: "accountant", farm: null, order: one, itemIds: ["O-I1"], ledger: oneLedger }), "меняет зав. складом"), true);
check("склад без производства", has(planFarmSwitch({ ...base, farm: "", order: one, itemIds: ["O-I1"], ledger: oneLedger }), "не указано производство"), true);
check("чужой цветок складу нельзя", has(planFarmSwitch({ ...base, farm: "rose_farm", order: one, itemIds: ["O-I1"], ledger: oneLedger }), "не ваше производство"), true);
check("ничего не отмечено", has(planFarmSwitch({ ...base, order: one, itemIds: [], ledger: oneLedger }), "Отметьте позиции"), true);
check("чужая позиция", has(planFarmSwitch({ ...base, order: one, itemIds: ["X-I9"], ledger: oneLedger }), "не из этой заявки"), true);
check("роза", has(planFarmSwitch({ ...base, role: "admin", farm: null, order: { ...one, items: [item(1, "rose", "Jumilia", "60", 30, 300)] }, itemIds: ["O-I1"], ledger: [] }), "только у хризантемы"), true);
check("уже отгружено", has(planFarmSwitch({ ...base, order: { ...one, items: [item(1, "chrysanthemum", "Altaj", "Вторая", 50, 400, 20)] }, itemIds: ["O-I1"], ledger: oneLedger }), "сначала оформите возврат"), true);
check("отменённая", planFarmSwitch({ ...base, order: { ...one, status: "cancelled" }, itemIds: ["O-I1"], ledger: oneLedger }), "Заявка отменена");
check("объём на город — складу нельзя", has(planFarmSwitch({ ...base, order: { ...one, kind: "region" }, itemIds: ["O-I1"], ledger: [] }), "администратор"), true);
check("объём на город — администратору можно", typeof planFarmSwitch({ ...base, role: "admin", farm: null, order: { ...one, kind: "region", paidAmount: 0, paidEsentai: 0 }, itemIds: ["O-I1"], ledger: [] }), "object");
check("ждёт оплаты счёт Kaspi — нельзя", has(planFarmSwitch({ ...base, order: one, itemIds: ["O-I1"], ledger: oneLedger, openInvoiceFarms: ["esentai"] }), "сначала бухгалтер отменяет счёт"), true);
check(
  "позиции с разных складов разом — нельзя",
  has(planFarmSwitch({ ...base, role: "admin", farm: null, order: { ...mix, items: [...mix.items, item(6, "chrysanthemum_rf", "Altaj", "Первая", 10, 500)] }, itemIds: ["O-I4", "O-I6"], ledger: mixLedger }), "одного склада"),
  true
);

console.log("— Деньги: вся заявка переходит (№3JA79) —");
const p1 = plan(planFarmSwitch({ ...base, order: one, itemIds: ["O-I1"], ledger: oneLedger }));
check("куда", [p1.fromFarm, p1.toFarm, p1.toFlower], ["esentai", "rose_farm", "chrysanthemum_rf"]);
check("получено: Есентай 0, Rose Farm 20 000", p1.paid, { roseFarm: 20000, esentai: 0 });
check("платёж целиком на Rose Farm", [p1.paymentUpdates, p1.paymentSplits], [[{ paymentId: "P1", farm: "rose_farm", flowerType: "chrysanthemum_rf" }], []]);

console.log("— Деньги: часть заявки (№JKDK8) —");
const p2 = plan(planFarmSwitch({ ...base, order: mix, itemIds: ["O-I4", "O-I5"], ledger: mixLedger }));
check("переходит 40 700, из денег — 40 500", [p2.movedAmount, p2.movedPaid], [40700, 40500]);
check("получено: Есентай 11 000, Rose Farm 40 500", p2.paid, { roseFarm: 40500, esentai: 11000 });
check("сумма «получено» не изменилась", (p2.paid?.roseFarm ?? 0) + (p2.paid?.esentai ?? 0), mix.paidAmount);
check("строка платежа делится", [p2.paymentUpdates, p2.paymentSplits], [
  [{ paymentId: "P1", amount: 11000, farm: "esentai" }],
  [{ fromPaymentId: "P1", amount: 40500, farm: "rose_farm", flowerType: "chrysanthemum_rf" }],
]);

console.log("— Обратно: Rose Farm → Есентай —");
const back: SwitchOrder = {
  status: "new",
  paidAmount: 51500,
  paidRoseFarm: 40500,
  paidEsentai: 11000,
  items: [item(2, "chrysanthemum", "Podolsk Yellow", "Третья", 25, 220), item(3, "chrysanthemum", "Pastella", "Третья", 25, 220), item(4, "chrysanthemum_rf", "Altaj", "Вторая", 50, 400), item(5, "chrysanthemum_rf", "Altaj", "Четвёртая", 115, 180)],
};
const backLedger = [
  { paymentId: "P1", amount: 11000, farm: "esentai", flowerType: "chrysanthemum" },
  { paymentId: "P2", amount: 40500, farm: "rose_farm", flowerType: "chrysanthemum_rf" },
];
const p3 = plan(planFarmSwitch({ ...base, farm: "rose_farm", order: back, itemIds: ["O-I4", "O-I5"], ledger: backLedger }));
check("всё вернулось Есентаю", [p3.paid, p3.paymentUpdates], [{ roseFarm: 0, esentai: 51500 }, [{ paymentId: "P2", farm: "esentai", flowerType: "chrysanthemum" }]]);
const withRose: SwitchOrder = { ...back, paidAmount: 60500, paidRoseFarm: 49500, items: [...back.items, item(6, "rose", "Jumilia", "60", 30, 300)] };
const p4 = plan(planFarmSwitch({ ...base, farm: "rose_farm", order: withRose, itemIds: ["O-I4", "O-I5"], ledger: [...backLedger, { paymentId: "P3", amount: 9000, farm: "rose_farm", flowerType: "rose" }] }));
check("деньги за розу остаются у Rose Farm", [p4.movedPaid, p4.paid, p4.paymentUpdates.map((u) => u.paymentId)], [40500, { roseFarm: 9000, esentai: 51500 }, ["P2"]]);

console.log("— Без денег и старые заявки —");
const unpaid = plan(planFarmSwitch({ ...base, order: { ...one, paidAmount: 0, paidEsentai: 0 }, itemIds: ["O-I1"], ledger: [] }));
check("неоплаченная: деньги не трогаются", [unpaid.paid, unpaid.movedPaid, unpaid.paymentUpdates.length], [null, 0, 0]);
const old = plan(planFarmSwitch({ ...base, order: { ...one, paidEsentai: 0 }, itemIds: ["O-I1"], ledger: [] }));
check("деньги одним числом, без журнала: уходят новой компании", old.paid, { roseFarm: 20000, esentai: 0 });
check(
  "смешанная заявка с неразнесённой оплатой — отказ",
  has(planFarmSwitch({ ...base, order: { ...withRose, paidRoseFarm: 0, paidEsentai: 0 }, itemIds: ["O-I2"], ledger: [] }), "не разнесена по компаниям"),
  true
);

if (fails > 0) {
  console.error(`\nНе прошло проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки пройдены");
