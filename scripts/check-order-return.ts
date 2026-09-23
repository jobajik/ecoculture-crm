/**
 * Возврат и перемещение в наш магазин (`src/lib/orderReturn.ts`).
 *
 * Главный случай — живая заявка менеджера Ильяса: роза Love Lydia 60 — 45 шт.
 * и хризантема Altaj «Вторая» — 150 шт., не оплачена и не отгружена. Хризантему
 * вернули на теплицу, розу увезли в наш магазин. Итог обязан быть таким:
 * заявка отменяется (в ней ничего не осталось), в магазин уходят 45 роз, а в
 * партии ничего не возвращается — со склада эти стебли и не списывались.
 *
 * Отдельно стережём границы: кто может, что можно вернуть на склад, сколько
 * можно передать в магазин, и что заявку с деньгами целиком не «вернуть».
 */
import {
  batchesToReturn,
  planReturn,
  returnAccess,
  statusAfterReturn,
  type ReturnOrder,
  type ReturnPlan,
} from "../src/lib/orderReturn";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const isPlan = (p: ReturnPlan | string): p is ReturnPlan => typeof p !== "string";
const refusalOf = (p: ReturnPlan | string) => (typeof p === "string" ? p : "");

const ILYAS = "ecoculture1970@gmail.com";
const base: ReturnOrder = {
  orderId: "ORD-260917-3U4E9",
  status: "new",
  managerEmail: ILYAS,
  retail: "",
  kind: "",
  paidAmount: 0,
  items: [
    { itemId: "I1", flowerType: "rose", variety: "Love Lydia", grade: "60", quantity: 45, unitPrice: 410, shippedQuantity: 0 },
    { itemId: "I2", flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 150, unitPrice: 400, shippedQuantity: 0 },
  ],
};
const REASON = "Клиент не оплатил";

// --- Кто может -------------------------------------------------------------------
const mgr = returnAccess(base, "manager", ILYAS, null);
check("менеджер своей заявки: пускают", mgr.refusal, "");
check("менеджер: все строки", mgr.itemIds, ["I1", "I2"]);
check("менеджер: отгруженное на склад не возвращает", mgr.canTakeShipped, false);
check("менеджер: в магазин переносить может", mgr.canMove, true);
check("менеджер: сразу списывать со склада не может", mgr.canShipNow, false);
check("чужой менеджер: отказ", returnAccess(base, "manager", "other@x", null).refusal !== "", true);
check("бухгалтер: отказ", returnAccess(base, "accountant", "acc@x", null).refusal !== "", true);
check("РОП: отказ", returnAccess(base, "sales_head", "rop@x", null).refusal !== "", true);
const razia = returnAccess(base, "warehouse", "razia@x", "rose_farm");
check("зав. складом Rose Farm: только роза", razia.itemIds, ["I1"]);
check("зав. складом: отгруженное вернуть может", razia.canTakeShipped, true);
check("зав. складом: списать сразу может", razia.canShipNow, true);
check("зав. складом без производства: отказ", returnAccess(base, "warehouse", "w@x", "").refusal !== "", true);
check(
  "зав. складом Есентая в заявке без хризантемы: отказ",
  returnAccess({ ...base, items: [base.items[0]] }, "warehouse", "diana@x", "esentai").refusal !== "",
  true
);
check("админ: всё", returnAccess(base, "admin", "boss@x", null).itemIds, ["I1", "I2"]);
check("отменённая заявка: отказ", returnAccess({ ...base, status: "cancelled" }, "admin", "boss@x", null).refusal !== "", true);
const shopOrder: ReturnOrder = { ...base, retail: "almaty", managerEmail: "asem@x" };
const asem = returnAccess(shopOrder, "retail_almaty", "asem@x", null);
check("заявка магазину: её менеджер возвращает", asem.refusal, "");
check("заявка магазину: в другой магазин не переносят", asem.canMove, false);
const allShipped: ReturnOrder = {
  ...base,
  status: "shipped",
  items: base.items.map((i) => ({ ...i, shippedQuantity: i.quantity })),
};
check(
  "всё отгружено — менеджеру возвращать нечего (это делает склад)",
  returnAccess(allShipped, "manager", ILYAS, null).refusal.includes("зав. складом"),
  true
);

// --- Живой случай Ильяса ------------------------------------------------------------
const ilyas = planReturn({
  order: base,
  access: mgr,
  reason: REASON,
  shopChosen: true,
  lines: [
    { itemId: "I1", back: 0, toShop: 45 },
    { itemId: "I2", back: 150, toShop: 0 },
  ],
});
check("Ильяс: план собран", isPlan(ilyas), true);
if (isPlan(ilyas)) {
  check("Ильяс: заявка отменяется", [ilyas.outcome, ilyas.newStatus], ["cancel", "cancelled"]);
  check("Ильяс: в магазин 45 роз", ilyas.moved, [{ flowerType: "rose", variety: "Love Lydia", grade: "60", quantity: 45 }]);
  check("Ильяс: в партии ничего не возвращается (не отгружалось)", ilyas.backToStock, 0);
  check("Ильяс: сумма 78 450 → 0", [ilyas.totalBefore, ilyas.totalAfter], [78450, 0]);
  check("Ильяс: строки не удаляются — отменённая хранит, что заказывали", ilyas.deleteItemIds, []);
}

// --- Частичный возврат ------------------------------------------------------------------
const part = planReturn({ order: base, access: mgr, reason: REASON, shopChosen: false, lines: [{ itemId: "I2", back: 50, toShop: 0 }] });
check("частично: живёт дальше", isPlan(part) && part.outcome, "partial");
if (isPlan(part)) {
  check("частично: 150 → 100", part.lines[0].newQuantity, 100);
  check("частично: сумма 78 450 → 58 450", part.totalAfter, 58450);
  check("частично: статус прежний", part.newStatus, "new");
  check("частично: ничего не удаляется", part.deleteItemIds, []);
}
const zeroLine = planReturn({ order: base, access: mgr, reason: REASON, shopChosen: false, lines: [{ itemId: "I2", back: 150, toShop: 0 }] });
check("строка обнулилась, заявка живёт: строка удаляется", isPlan(zeroLine) && zeroLine.deleteItemIds, ["I2"]);

// --- Границы ------------------------------------------------------------------------------
const plan = (lines: { itemId: string; back: number; toShop: number }[], order = base, access = mgr, reason = REASON, shop = true) =>
  planReturn({ order, lines, access, reason, shopChosen: shop });
check("причина пустая: отказ", refusalOf(plan([{ itemId: "I2", back: 1, toShop: 0 }], base, mgr, " ")).includes("причину"), true);
check("ничего не указано: отказ", refusalOf(plan([{ itemId: "I2", back: 0, toShop: 0 }])).includes("Укажите"), true);
check("дробные стебли: отказ", refusalOf(plan([{ itemId: "I2", back: 1.5, toShop: 0 }])).includes("целое"), true);
check("минус: отказ", refusalOf(plan([{ itemId: "I2", back: -3, toShop: 0 }])).includes("целое"), true);
check("чужая строка: отказ", refusalOf(plan([{ itemId: "X9", back: 1, toShop: 0 }])).includes("не из этой"), true);
check(
  "дважды одна строка: отказ",
  refusalOf(plan([{ itemId: "I2", back: 1, toShop: 0 }, { itemId: "I2", back: 1, toShop: 0 }])).includes("дважды"),
  true
);
check("больше заказанного: отказ", refusalOf(plan([{ itemId: "I2", back: 100, toShop: 60 }])).includes("заказано 150"), true);
check("в магазин без выбранного магазина: отказ", refusalOf(plan([{ itemId: "I1", back: 0, toShop: 5 }], base, mgr, REASON, false)), "Выберите магазин");
check(
  "склад Rose Farm трогает хризантему: отказ",
  refusalOf(plan([{ itemId: "I2", back: 10, toShop: 0 }], base, razia)).includes("не ваше"),
  true
);
check(
  "из заявки магазину — в другой магазин: отказ",
  refusalOf(plan([{ itemId: "I1", back: 0, toShop: 5 }], shopOrder, asem)).includes("не перемещают"),
  true
);

// Частично отгруженная: 150 заказано, 100 отгружено.
const partShipped: ReturnOrder = {
  ...base,
  status: "in_progress",
  items: [base.items[0], { ...base.items[1], shippedQuantity: 100 }],
};
const mgrPS = returnAccess(partShipped, "manager", ILYAS, null);
check("в магазин больше неотгруженного: отказ", refusalOf(plan([{ itemId: "I2", back: 0, toShop: 60 }], partShipped, mgrPS)).includes("50 шт"), true);
check(
  "менеджер возвращает уехавшее: отказ",
  refusalOf(plan([{ itemId: "I2", back: 70, toShop: 0 }], partShipped, mgrPS)).includes("уже отгружены"),
  true
);
const admin = returnAccess(partShipped, "admin", "boss@x", null);
const back70 = plan([{ itemId: "I2", back: 70, toShop: 0 }], partShipped, admin);
check("админ возвращает 70 из 150 (50 не уехало + 20 уехавших)", isPlan(back70) && [back70.lines[0].fromShipped, back70.lines[0].newShipped, back70.lines[0].newQuantity], [20, 80, 80]);
check("после возврата: отгружено 80 из 80 хризантемы, роза ждёт — «частично»", isPlan(back70) && back70.newStatus, "in_progress");
const mixed = plan([{ itemId: "I2", back: 30, toShop: 20 }], partShipped, admin);
check("в магазин берётся из НЕотгруженного, вернуть — из остатка, потом из уехавшего", isPlan(mixed) && [mixed.lines[0].fromShipped, mixed.lines[0].newQuantity, mixed.lines[0].newShipped], [0, 100, 100]);

// Деньги.
const paid: ReturnOrder = { ...base, paidAmount: 78450 };
const mgrPaid = returnAccess(paid, "manager", ILYAS, null);
check(
  "оплаченную целиком не «вернуть» — сначала деньги",
  refusalOf(plan([{ itemId: "I1", back: 45, toShop: 0 }, { itemId: "I2", back: 150, toShop: 0 }], paid, mgrPaid)).includes("оплата"),
  true
);
const paidPart = plan([{ itemId: "I2", back: 50, toShop: 0 }], paid, mgrPaid);
check("оплаченная, частично: остаётся «оплачено» (появится переплата)", isPlan(paidPart) && paidPart.paid, true);
const halfPaid = plan([{ itemId: "I2", back: 50, toShop: 0 }], { ...base, paidAmount: 58450 }, returnAccess({ ...base, paidAmount: 58450 }, "manager", ILYAS, null));
check("оплачено 58 450, после возврата сумма 58 450 — становится «оплачено»", isPlan(halfPaid) && halfPaid.paid, true);

// --- Статус --------------------------------------------------------------------------------
check("вернули всё уехавшее: «отгружена» → «новая»", statusAfterReturn("shipped", [{ quantity: 10, shippedQuantity: 0 }]), "new");
check("остаток отгружен целиком: «отгружена»", statusAfterReturn("in_progress", [{ quantity: 10, shippedQuantity: 10 }]), "shipped");
check("отменённая остаётся отменённой", statusAfterReturn("cancelled", [{ quantity: 10, shippedQuantity: 10 }]), "cancelled");

// --- Из каких партий вернуть ------------------------------------------------------------------
const journal = [
  { batchId: "B1", quantity: 50, createdAt: "2026-09-10T08:00:00Z" },
  { batchId: "B2", quantity: 30, createdAt: "2026-09-12T08:00:00Z" },
  { batchId: "B3", quantity: 20, createdAt: "2026-09-14T08:00:00Z" },
  { batchId: "B3", quantity: -5, createdAt: "2026-09-15T08:00:00Z" },
];
check("последние отгрузки возвращаются первыми, с учётом прежнего возврата", batchesToReturn(journal, 40), {
  parts: [{ batchId: "B3", quantity: 15 }, { batchId: "B2", quantity: 25 }],
  missing: 0,
});
check("журнал короче, чем просят: видно, сколько не нашлось", batchesToReturn(journal, 120).missing, 25);
check("пустой журнал", batchesToReturn([], 5), { parts: [], missing: 5 });

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
