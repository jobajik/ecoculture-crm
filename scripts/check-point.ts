/*
 * Точка на базаре («Пожарка») — перемещение, а не продажа.
 *
 * Что стережём:
 *   - заявка «Пожарка» — не продажа (`isNotASale`), а магазин и опт — тоже;
 *   - отвезли — по ОТГРУЖЕННОМУ и цене заявки, в день доставки;
 *   - выручка — из отчётов за день + прежние платежи на заявки-перемещения;
 *   - «на точке примерно» = всё отвезённое − вся выручка − все списания;
 *   - цена списания — средняя цена отвезённого цветка;
 *   - бонус с выручки точки — менеджерам по отвезённому, по ставке цветка;
 *   - кто вносит (бухгалтер, админ) и проверки ввода.
 *
 * Запуск: npx tsx scripts/check-point.ts
 */
import {
  avgTransferPrice,
  canEditPoint,
  pointBonusShares,
  pointDayRefusal,
  pointMoneyClearRefusal,
  pointOrdersWithMoney,
  pointReport,
  pointWriteoffRefusal,
  type TransferOrder,
} from "../src/lib/point";
import { isNotASale } from "../src/lib/orderKind";
import { getLeaderboard } from "../src/lib/leaderboard";
import { ROLES } from "../src/lib/constants";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const refused = (s: string) => s.length > 0;

check("пожарка — не продажа", isNotASale({ direction: "Пожарка", retail: "", kind: "" }), true);
check("обычная заявка — продажа", isNotASale({ direction: "", retail: "", kind: "" }), false);
check("наш магазин — не продажа", isNotASale({ direction: "", retail: "almaty", kind: "" }), true);
check("опт на город — не продажа", isNotASale({ direction: "Астана", retail: "", kind: "region" }), true);

const t = (
  orderId: string,
  day: string,
  manager: string,
  items: [string, number, number, number][],
  extra: Partial<TransferOrder> = {}
): TransferOrder & { clientName: string } => ({
  orderId,
  createdAt: `${day}T08:00:00.000Z`,
  deliveryDate: day,
  managerEmail: manager,
  status: "shipped",
  direction: "Пожарка",
  retail: "",
  kind: "",
  paidAmount: 0,
  paidAt: "",
  clientName: "Точка на базаре",
  items: items.map(([flowerType, quantity, unitPrice, shippedQuantity]) => ({ flowerType, quantity, unitPrice, shippedQuantity })),
  ...extra,
});

const orders = [
  t("P1", "2026-08-28", "emil@x", [["chrysanthemum", 100, 300, 100]]), // август
  t("P2", "2026-09-05", "emil@x", [["chrysanthemum", 200, 300, 200], ["rose", 100, 400, 50]]), // роза отгружена наполовину
  t("P3", "2026-09-12", "ilyas@x", [["chrysanthemum", 100, 350, 100]]),
  t("P4", "2026-09-20", "emil@x", [["chrysanthemum", 100, 300, 0]]), // ещё не отгружено
  t("P5", "2026-09-10", "emil@x", [["chrysanthemum", 50, 300, 50]], { status: "cancelled" }),
  t("OLD", "2026-09-01", "emil@x", [["rose", 10, 500, 10]], { paidAmount: 5000, paidAt: "2026-09-02" }), // старый платёж на заявку
  { ...t("SALE", "2026-09-05", "emil@x", [["rose", 100, 400, 100]]), direction: "" }, // обычная продажа — не точка
];

// Деньги, внесённые прямо на перемещения: бухгалтер снимает их и вносит по дням.
{
  const withMoney = [
    ...orders,
    t("OLD2", "2026-09-03", "emil@x", [["rose", 10, 500, 10]], { paidAmount: 3000, paidAt: "2026-09-05" }),
    t("CANC", "2026-09-03", "emil@x", [["rose", 10, 500, 10]], { paidAmount: 999, paidAt: "2026-09-05", status: "cancelled" }),
    t("SALE", "2026-09-03", "emil@x", [["rose", 10, 500, 10]], { paidAmount: 5000, paidAt: "2026-09-05", direction: "" }),
  ];
  check("с деньгами: только перемещения, без отменённых, свежая оплата сверху", pointOrdersWithMoney(withMoney).map((o) => o.orderId), ["OLD2", "OLD"]);
  check("снять может бухгалтер", pointMoneyClearRefusal(ROLES.ACCOUNTANT, ["OLD", "OLD2"], withMoney), "");
  check("РОП не может", refused(pointMoneyClearRefusal(ROLES.SALES_HEAD, ["OLD"], withMoney)), true);
  check("обычную продажу так не снять", refused(pointMoneyClearRefusal(ROLES.ACCOUNTANT, ["SALE"], withMoney)), true);
  check("пустой выбор — отказ", refused(pointMoneyClearRefusal(ROLES.ADMIN, [], withMoney)), true);
}

const days = [
  { date: "2026-09-06", kaspi: 30000, cash: 10000, note: "", accountantEmail: "", updatedAt: "" },
  { date: "2026-09-13", kaspi: 20000, cash: 0, note: "дождь", accountantEmail: "", updatedAt: "" },
  { date: "2026-08-30", kaspi: 25000, cash: 0, note: "", accountantEmail: "", updatedAt: "" },
];
const writeoffs = [
  { writeoffId: "W1", date: "2026-09-14", flowerType: "chrysanthemum", quantity: 20, amount: 6000, reason: "завяла", createdByEmail: "", createdAt: "" },
];

const r = pointReport({ orders, days, writeoffs, month: "2026-09", today: "2026-09-29" });
check("отвезли: только отгруженное, без отменённой и чужой", [r.transferred.stems, r.transferred.amount], [360, 60000 + 20000 + 35000 + 5000]);
check("выручка: отчёты + прежний платёж", [r.revenue.kaspi, r.revenue.cash, r.revenue.fromOrders, r.revenue.total], [50000, 10000, 5000, 65000]);
check("списано", [r.writeoffs.stems, r.writeoffs.amount], [20, 6000]);
// Всё до сегодня: отвезли 30 000 (авг) + 120 000; выручка 25 000 + 65 000; списано 6 000.
check("на точке примерно", r.onPoint, 150000 - 90000 - 6000);
check("продано от отвезённого, %", r.sellThrough, Math.round((65000 / 120000) * 100));
check("по цветкам: порядок и стебли", r.flowers.map((f) => [f.flowerType, f.stems, f.writeoffStems]), [
  ["rose", 60, 0],
  ["chrysanthemum", 300, 20],
]);
check("дни — от новых к старым", r.days.map((d) => d.date), ["2026-09-14", "2026-09-13", "2026-09-12", "2026-09-06", "2026-09-05", "2026-09-02", "2026-09-01"]);

check("цена списания — средняя отвезённого", avgTransferPrice(orders, "chrysanthemum", "2026-09-14"), Math.round((30000 + 60000 + 35000) / 400 * 100) / 100);
check("цены нет — ноль", avgTransferPrice(orders, "eustoma", "2026-09-14"), 0);

const shares = pointBonusShares({ orders, days, from: "2026-09-01", to: "2026-09-30" });
const byKey = Object.fromEntries(shares.map((s) => [`${s.managerEmail}|${s.flowerType}`, [s.amount, s.bonus]]));
// Выручка 65 000 делится по отвезённому за сентябрь: 120 000.
check("бонус: доли по отвезённому", byKey, {
  "emil@x|chrysanthemum": [32500, 650],
  "emil@x|rose": [13541.67, 203.13],
  "ilyas@x|chrysanthemum": [18958.33, 379.17],
});
check("бонус: сумма долей = выручка", Math.round(shares.reduce((s, x) => s + x.amount, 0)), 65000);
check("нет выручки — нет бонуса", pointBonusShares({ orders, days: [], from: "2026-10-01", to: "2026-10-31" }), []);

check("вносит бухгалтер", [canEditPoint(ROLES.ACCOUNTANT), canEditPoint(ROLES.ADMIN), canEditPoint(ROLES.SALES_HEAD), canEditPoint(ROLES.MANAGER)], [true, true, false, false]);
check("выручка: из будущего нельзя", refused(pointDayRefusal({ role: ROLES.ACCOUNTANT, date: "2026-09-30", today: "2026-09-29", kaspi: 1, cash: 0 })), true);
check("выручка: минус нельзя", refused(pointDayRefusal({ role: ROLES.ACCOUNTANT, date: "2026-09-29", today: "2026-09-29", kaspi: -1, cash: 0 })), true);
check("выручка: РОП не вносит", refused(pointDayRefusal({ role: ROLES.SALES_HEAD, date: "2026-09-29", today: "2026-09-29", kaspi: 1, cash: 0 })), true);
check("выручка: нормально", pointDayRefusal({ role: ROLES.ACCOUNTANT, date: "2026-09-29", today: "2026-09-29", kaspi: 1000, cash: 500 }), "");
check("списание: без причины нельзя", refused(pointWriteoffRefusal({ role: ROLES.ACCOUNTANT, date: "2026-09-29", today: "2026-09-29", flowerType: "rose", quantity: 5, reason: " " })), true);
check("списание: дробные стебли нельзя", refused(pointWriteoffRefusal({ role: ROLES.ACCOUNTANT, date: "2026-09-29", today: "2026-09-29", flowerType: "rose", quantity: 1.5, reason: "x" })), true);
check("списание: нормально", pointWriteoffRefusal({ role: ROLES.ADMIN, date: "2026-09-29", today: "2026-09-29", flowerType: "rose", quantity: 5, reason: "завяла" }), "");

async function main() {
  // Рейтинг: заявка на точку — не продажа, а выручка точки — в бонус.
  const board = await getLeaderboard("month", "2026-09-15", new Date("2026-09-29T12:00:00"), {
    orders: orders.map((o) => ({ ...o, paid: false, totalAmount: 0, notes: "", managerConfirmed: true, managerConfirmedAt: "", paymentMethod: "", accountantEmail: "", paidRoseFarm: 0, paidEsentai: 0, promisedAt: "", collectionNote: "", clientId: "", clientPhone: "", invoiceSentAt: "", invoiceNote: "", realization1c: "", clientPaymentTerms: "", items: o.items.map((i, k) => ({ ...i, orderId: o.orderId, itemId: `${o.orderId}-${k}`, variety: "", grade: "" })) })) as never,
    users: [
      { email: "emil@x", name: "Эмиль", role: "manager", farm: null, active: true },
      { email: "ilyas@x", name: "Ильяс", role: "manager", farm: null, active: true },
    ] as never,
    plans: new Map(),
    pointDays: days,
  });
  const emil = board.rows.find((x) => x.managerEmail === "emil@x")!;
  const ilyas = board.rows.find((x) => x.managerEmail === "ilyas@x")!;
  check("рейтинг: у Эмиля одна продажа, точки в заявках нет", emil.orders, 1);
  check("рейтинг: доля точки у Эмиля", Math.round(emil.pointAmount), 46042);
  check("рейтинг: Ильяс попал только выручкой точки", [ilyas.orders, Math.round(ilyas.pointAmount)], [0, 18958]);
  check("рейтинг: бонус Ильяса — 2 % с хризантемы", Math.round(ilyas.bonus), 379);

  console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
