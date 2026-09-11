/*
 * Оптовый объём на город — заявка без клиента и без цены.
 *
 * Первую версию этого раздела я сделал неправильно: приделал «направление» к
 * обычной клиентской форме. Владелец сказал прямо: «Опт регионы — это просто
 * типа выставляешь количество, сорт и выбираешь регион. Без клиентов и прочее».
 * Отсюда отдельный вид заявки — и отсюда же места, где легко ошибиться.
 *
 * Первое и главное: **цены у такой заявки нет**. Ноль в позиции — не забытое
 * поле, а её природа. Пусти такую заявку в продажи — и средняя цена по цветку
 * поедет вниз на ровном месте, а выручка не изменится: стебли есть, денег нет.
 *
 * Второе: **счёта нет, значит нет и долга**. Заявка не должна попадать ни в
 * долги, ни в список звонков, ни в бонусы, ни в клиентскую базу. И отгрузку
 * она обязана открывать ОДНОЙ галочкой: вторая ждала бы оплаты по счёту,
 * которого не существует, и заявка зависла бы навсегда.
 *
 * Третье: **деньги приходят с другой стороны**. Бухгалтер вписывает, сколько
 * по городу поступило, и эта сумма не равна «цена × количество».
 *
 * Запуск: npx tsx scripts/check-region-orders.ts
 */
import {
  buildRegionIncome,
  canFillRegionOrders,
  cleanOrderKind,
  hasNoClientInvoice,
  isRegionOrder,
  regionIncomeRefusal,
  regionOrderRefusal,
} from "../src/lib/orderKind";
import { isReadyToShip, missingForShip } from "../src/lib/orderReady";
import { cancelRefusal, confirmRefusal } from "../src/lib/orderRules";
import { getFinanceSnapshot } from "../src/lib/finance";
import { getLeaderboard } from "../src/lib/leaderboard";
import { buildClientStats } from "../src/lib/clientStats";
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

// --- Что такое городская заявка ---------------------------------------------

check("значение колонки распознаётся", cleanOrderKind("region"), ORDER_KINDS.REGION);
check("регистр не мешает", cleanOrderKind("Region"), ORDER_KINDS.REGION);
check("пустое — обычная заявка", cleanOrderKind(""), ORDER_KINDS.CLIENT);
check("незнакомое — обычная заявка (грабли 1.10)", cleanOrderKind("что-то"), ORDER_KINDS.CLIENT);
check("старая заявка без колонки — обычная", isRegionOrder({}), false);

check("городская заявка без счёта клиенту", hasNoClientInvoice({ kind: "region" }), true);
check("заявка в наш магазин тоже", hasNoClientInvoice({ retail: "almaty" }), true);
check("обычная продажа — со счётом", hasNoClientInvoice({ retail: "", kind: "" }), false);

// --- Права ------------------------------------------------------------------

check("РОП заводит объём на город", canFillRegionOrders(ROLES.SALES_HEAD), true);
check("администратор тоже", canFillRegionOrders(ROLES.ADMIN), true);
check("менеджер не заводит", canFillRegionOrders(ROLES.MANAGER), false);
check("бухгалтер не заводит", canFillRegionOrders(ROLES.ACCOUNTANT), false);
check("пустая роль не заводит (грабли 1.10)", canFillRegionOrders(""), false);

// --- Отказ сервера при оформлении -------------------------------------------

const GOOD: { role: string; direction: string; deliveryDate: string; items: { variety: string; grade: string; quantity: number }[] } = {
  role: ROLES.SALES_HEAD,
  direction: "Астана",
  deliveryDate: "2026-09-15",
  items: [{ variety: "Freedom", grade: "60", quantity: 500 }],
};
const refusal = (patch: Partial<typeof GOOD>) => regionOrderRefusal({ ...GOOD, ...patch });

check("обычная заявка проходит", refusal({}), "");
check("менеджеру нельзя", refusal({ role: ROLES.MANAGER }) !== "", true);
check("без региона нельзя", refusal({ direction: "" }) !== "", true);
check("неизвестный регион нельзя", refusal({ direction: "Ташкент" }) !== "", true);
check("без даты нельзя", refusal({ deliveryDate: "" }) !== "", true);
check("кривая дата нельзя", refusal({ deliveryDate: "15.09.2026" }) !== "", true);
check("без позиций нельзя", refusal({ items: [] }) !== "", true);
check(
  "ноль стеблей нельзя",
  refusal({ items: [{ variety: "Freedom", grade: "60", quantity: 0 }] }) !== "",
  true
);
check(
  "половина стебля нельзя",
  refusal({ items: [{ variety: "Freedom", grade: "60", quantity: 2.5 }] }) !== "",
  true
);
check(
  "без сорта нельзя",
  refusal({ items: [{ variety: " ", grade: "60", quantity: 10 }] }) !== "",
  true
);

// --- Одна галочка, а не две -------------------------------------------------

const REGION_ORDER = {
  managerConfirmed: true,
  paid: false,
  paidAmount: 0,
  totalAmount: 0,
  kind: ORDER_KINDS.REGION,
};
check("подтверждённая городская заявка готова к сборке", isReadyToShip(REGION_ORDER), true);
check(
  "неподтверждённая — не готова",
  isReadyToShip({ ...REGION_ORDER, managerConfirmed: false }),
  false
);
check(
  "оплаты у неё не ждут вовсе",
  missingForShip({ ...REGION_ORDER, managerConfirmed: false }),
  ["подтверждения объёма"]
);
check(
  "у обычной заявки по-прежнему две галочки",
  missingForShip({ managerConfirmed: false, paid: false, paidAmount: 0, totalAmount: 100 }),
  ["подтверждения менеджера", "оплаты"]
);

// --- Кто подтверждает и отменяет --------------------------------------------

const ROP = "rop@ecoculture.kz";
const confirmArgs = { status: ORDER_STATUSES.NEW, managerEmail: ROP, kind: ORDER_KINDS.REGION };
check("РОП подтверждает свою городскую заявку", confirmRefusal(confirmArgs, ROLES.SALES_HEAD, ROP, true), "");
check(
  "менеджер её не подтверждает",
  confirmRefusal(confirmArgs, ROLES.MANAGER, ROP, true) !== "",
  true
);
check(
  "чужую городскую заявку не подтвердить",
  confirmRefusal(confirmArgs, ROLES.SALES_HEAD, "other@ecoculture.kz", true) !== "",
  true
);
check(
  "РОП отменяет свою городскую заявку",
  cancelRefusal(
    { status: ORDER_STATUSES.NEW, managerEmail: ROP, items: [{ shippedQuantity: 0 }], kind: ORDER_KINDS.REGION },
    ROLES.SALES_HEAD,
    ROP
  ),
  ""
);
check(
  "отгруженную не отменить и здесь",
  cancelRefusal(
    { status: ORDER_STATUSES.NEW, managerEmail: ROP, items: [{ shippedQuantity: 10 }], kind: ORDER_KINDS.REGION },
    ROLES.SALES_HEAD,
    ROP
  ) !== "",
  true
);

// --- Сумма поступлений ------------------------------------------------------

const income = (patch: Partial<Parameters<typeof regionIncomeRefusal>[0]>) =>
  regionIncomeRefusal({
    role: ROLES.ACCOUNTANT,
    amount: 500_000,
    status: ORDER_STATUSES.NEW,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
    ...patch,
  });

check("бухгалтер вписывает сумму", income({}), "");
check("администратор тоже", income({ role: ROLES.ADMIN }), "");
check("РОП сумму не вписывает", income({ role: ROLES.SALES_HEAD }) !== "", true);
check("ноль допускается — значит ещё не пришло", income({ amount: 0 }), "");
check("минус нельзя", income({ amount: -1 }) !== "", true);
check("по отменённой нельзя", income({ status: ORDER_STATUSES.CANCELLED }) !== "", true);

// --- Городская заявка не трогает деньги клиентов -----------------------------

const NOW = new Date("2026-09-15T12:00:00");
const MONEY_ORDERS = [
  {
    orderId: "ORD-CLIENT",
    createdAt: "2026-09-10T10:00:00",
    deliveryDate: "2026-09-12",
    managerEmail: "emil@ecoculture.kz",
    clientId: "C1",
    clientName: "ТОО «Флора»",
    status: ORDER_STATUSES.NEW,
    paid: false,
    paidAmount: 0,
    totalAmount: 300_000,
    retail: "",
    kind: "",
    items: [
      { flowerType: "rose", variety: "Freedom", grade: "60", quantity: 600, unitPrice: 500, shippedQuantity: 0 },
    ],
  },
  {
    // Городская: стебли есть, цены нет, поступления подтверждены.
    orderId: "ORD-REGION",
    createdAt: "2026-09-10T10:00:00",
    deliveryDate: "2026-09-12",
    managerEmail: ROP,
    clientId: "",
    clientName: "Астана",
    status: ORDER_STATUSES.NEW,
    paid: true,
    paidAmount: 900_000,
    totalAmount: 0,
    retail: "",
    kind: ORDER_KINDS.REGION,
    direction: "Астана",
    items: [
      { flowerType: "rose", variety: "Freedom", grade: "60", quantity: 3000, unitPrice: 0, shippedQuantity: 0 },
    ],
  },
];

async function moneyChecks() {
  const users: { email: string; name: string; role: string; farm: null; active: boolean }[] = [
    { email: "emil@ecoculture.kz", name: "Эмиль", role: "manager", farm: null, active: true },
    { email: ROP, name: "Марат", role: "sales_head", farm: null, active: true },
  ];

  const finance = await getFinanceSnapshot("month", "2026-09-15", NOW, {
    orders: MONEY_ORDERS as never,
    users: users as never,
  });
  check(
    "у бухгалтера городской заявки в списке нет",
    finance.orders.map((r) => r.orderId),
    ["ORD-CLIENT"]
  );
  check("в долги она не попадает", finance.debts.length, 1);
  check("и в звонки тоже", finance.calls.every((c) => c.orderId !== "ORD-REGION"), true);

  const board = await getLeaderboard("month", "2026-09-15", NOW, {
    orders: MONEY_ORDERS as never,
    users: users as never,
    plans: new Map(),
  });
  check(
    "бонусов по городской заявке нет",
    board.rows.some((r) => r.managerEmail === ROP),
    false
  );

  const stats = buildClientStats({
    clients: [
      {
        clientId: "C1",
        name: "ТОО «Флора»",
        city: "Алматы",
        managerEmail: "emil@ecoculture.kz",
        active: true,
        retail: "",
      },
    ] as never,
    orders: MONEY_ORDERS as never,
    nameByEmail: new Map(),
    now: NOW,
    positionLabel: (f: string, g: string) => `${f} ${g}`,
  });
  check("в клиентской базе городской заявки нет", stats.totals.revenue, 300_000);
  check("и «заявкой без клиента» она не считается", stats.ordersWithoutClient, 0);
}

// --- Поступления по городам --------------------------------------------------

const rows = buildRegionIncome({
  orders: [
    { direction: "Астана", deliveryDate: "2026-09-12", status: ORDER_STATUSES.NEW, kind: "region", paidAmount: 900_000, items: [{ quantity: 3000 }] },
    { direction: "Астана", deliveryDate: "2026-09-13", status: ORDER_STATUSES.NEW, kind: "region", paidAmount: 0, items: [{ quantity: 500 }] },
    { direction: "Семей", deliveryDate: "2026-09-12", status: ORDER_STATUSES.NEW, kind: "region", paidAmount: 200_000, items: [{ quantity: 800 }] },
    // Отменённая и обычная клиентская в счёт не идут.
    { direction: "Семей", deliveryDate: "2026-09-12", status: ORDER_STATUSES.CANCELLED, kind: "region", paidAmount: 999, items: [{ quantity: 999 }] },
    { direction: "Астана", deliveryDate: "2026-09-12", status: ORDER_STATUSES.NEW, kind: "", paidAmount: 111, items: [{ quantity: 111 }] },
    // Чужой период.
    { direction: "Астана", deliveryDate: "2026-10-02", status: ORDER_STATUSES.NEW, kind: "region", paidAmount: 555, items: [{ quantity: 555 }] },
  ],
  from: "2026-09-07",
  to: "2026-09-13",
  cancelledStatus: ORDER_STATUSES.CANCELLED,
});

check("городов в сводке", rows.map((r) => r.direction), ["Астана", "Семей"]);
check("Астана: стебли за неделю", rows[0].stems, 3500);
check("Астана: поступило", rows[0].income, 900_000);
check("Астана: одна заявка ещё без суммы", rows[0].waitingIncome, 1);
check("Семей: поступило", rows[1].income, 200_000);
check("отменённая и клиентская в сводку не попали", rows[1].stems, 800);
check(
  "пустые данные не роняют",
  buildRegionIncome({ orders: [], from: "2026-09-01", to: "2026-09-30", cancelledStatus: ORDER_STATUSES.CANCELLED }),
  []
);

moneyChecks()
  .then(() => {
    console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
    process.exit(fails === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
