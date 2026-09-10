/*
 * Собственная розница: наши магазины, их заявки и деньги, которых по ним нет.
 *
 * Здесь легко ошибиться тихо и очень дорого. Стоит один раз посчитать
 * внутреннее перемещение продажей — и выручка задвоится: сначала когда цветок
 * уехал в наш магазин, потом когда магазин продал его покупателю. Ошибка в
 * другую сторону не дешевле: если заявке в магазин потребовать оплату, она
 * повиснет навсегда, потому что платить по ней некому.
 *
 * Запуск: npx tsx scripts/check-retail.ts
 */
import {
  buildRetailSummary,
  buildShopDay,
  canCreateCard,
  canOrderForShop,
  canSeeShop,
  cleanTerritory,
  isOwnShop,
  isRetailOrder,
  isRetailRole,
  retailTerritoryFor,
  shopDeliveries,
  territoriesFor,
} from "../src/lib/retail";
import { isReadyToShip, missingForShip, notReadyReason } from "../src/lib/orderReady";
import { cancelRefusal } from "../src/lib/orderRules";
import { buildClientStats } from "../src/lib/clientStats";
import { getFinanceSnapshot } from "../src/lib/finance";
import { getLeaderboard } from "../src/lib/leaderboard";
import { ORDER_STATUSES, ROLES } from "../src/lib/constants";
import { cleanPriceKind, currentPrices, priceFor, PRICE_KINDS } from "../src/lib/priceList";

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

const NOW = new Date("2026-09-10T12:00:00");
function day(offset: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// --- Кто есть кто --------------------------------------------------------

check("менеджер розницы Алматы заведует своим направлением", retailTerritoryFor(ROLES.RETAIL_ALMATY), "almaty");
check("менеджер розницы регионов — своим", retailTerritoryFor(ROLES.RETAIL_REGIONS), "regions");
check("обычный менеджер розницей не заведует", retailTerritoryFor(ROLES.MANAGER), null);
// Грабли 1.10: у админа null означает «не привязан», а не «никакой».
check("админ не привязан к одному направлению", retailTerritoryFor(ROLES.ADMIN), null);
check("но видит оба", territoriesFor(ROLES.ADMIN), ["almaty", "regions"]);
check("РОП видит оба", territoriesFor(ROLES.SALES_HEAD), ["almaty", "regions"]);
check("менеджер розницы — только своё", territoriesFor(ROLES.RETAIL_ALMATY), ["almaty"]);
check("обычный менеджер — ничего", territoriesFor(ROLES.MANAGER), []);
check("склад розницы не ведёт", territoriesFor(ROLES.WAREHOUSE), []);

const SHOP_ALMATY = { retail: "almaty" };
const SHOP_REGION = { retail: "regions" };
const CLIENT = { retail: "" };

check("наш магазин отличается от клиента", [isOwnShop(SHOP_ALMATY), isOwnShop(CLIENT)], [true, false]);
check("алматинец видит свой магазин", canSeeShop(ROLES.RETAIL_ALMATY, SHOP_ALMATY), true);
check("и НЕ видит региональный", canSeeShop(ROLES.RETAIL_ALMATY, SHOP_REGION), false);
check("регионы не видят Алматы", canSeeShop(ROLES.RETAIL_REGIONS, SHOP_ALMATY), false);
check("обычный менеджер магазинов не видит", canSeeShop(ROLES.MANAGER, SHOP_ALMATY), false);
check("бухгалтер тоже", canSeeShop(ROLES.ACCOUNTANT, SHOP_ALMATY), false);
check("РОП видит любой", canSeeShop(ROLES.SALES_HEAD, SHOP_REGION), true);
check("клиент магазином не становится ни для кого", canSeeShop(ROLES.SALES_HEAD, CLIENT), false);

// РОП видит обе розницы, но заявки за менеджера не оформляет: иначе непонятно,
// чья это заявка и с кого спрашивать.
check("РОП заявку в магазин не оформляет", canOrderForShop(ROLES.SALES_HEAD, SHOP_ALMATY), false);
check("алматинец оформляет в свой", canOrderForShop(ROLES.RETAIL_ALMATY, SHOP_ALMATY), true);
check("но не в чужой", canOrderForShop(ROLES.RETAIL_ALMATY, SHOP_REGION), false);
check("админ может всё", canOrderForShop(ROLES.ADMIN, SHOP_REGION), true);

// Список магазинов закрытый: менеджер розницы выбирает из готового, а не
// набирает руками. Иначе одна точка появится под тремя написаниями.
check("менеджер розницы карточек не заводит", canCreateCard(ROLES.RETAIL_ALMATY), false);
check("и региональный тоже", canCreateCard(ROLES.RETAIL_REGIONS), false);
check("РОП заводит", canCreateCard(ROLES.SALES_HEAD), true);
check("обычный менеджер заводит клиента", canCreateCard(ROLES.MANAGER), true);

check("выдуманное направление не проходит", cleanTerritory("moscow"), "");
check("пустое остаётся пустым", cleanTerritory(undefined), "");
check("известное проходит", cleanTerritory(" almaty "), "almaty");
check("розничные роли опознаются", [isRetailRole(ROLES.RETAIL_REGIONS), isRetailRole(ROLES.MANAGER)], [true, false]);

// --- Отгрузка: у розницы галочка одна -------------------------------------

const RETAIL_ORDER_CONFIRMED = {
  managerConfirmed: true,
  paid: false,
  paidAmount: 0,
  totalAmount: 200_000,
  retail: "almaty",
};
const RETAIL_ORDER_NEW = { ...RETAIL_ORDER_CONFIRMED, managerConfirmed: false };
const CLIENT_ORDER_CONFIRMED = { ...RETAIL_ORDER_CONFIRMED, retail: "" };

check(
  "подтверждённая заявка в магазин отгружается без оплаты",
  isReadyToShip(RETAIL_ORDER_CONFIRMED),
  true
);
check(
  "та же заявка клиенту без оплаты НЕ отгружается",
  isReadyToShip(CLIENT_ORDER_CONFIRMED),
  false
);
check("неподтверждённая розничная не отгружается", isReadyToShip(RETAIL_ORDER_NEW), false);
check(
  "и причина не поминает оплату — платить некому",
  notReadyReason(RETAIL_ORDER_NEW),
  "Ждёт подтверждения менеджера розницы"
);
check("у готовой розничной причин нет", missingForShip(RETAIL_ORDER_CONFIRMED), []);
check(
  "у клиентской заявки причина прежняя",
  notReadyReason({ ...CLIENT_ORDER_CONFIRMED, managerConfirmed: false }),
  "Ждёт подтверждения менеджера и оплаты"
);

// --- Отмена ---------------------------------------------------------------

const CANCEL_ORDER = {
  status: ORDER_STATUSES.NEW,
  managerEmail: "retail.almaty@x.kz",
  items: [{ shippedQuantity: 0 }],
  retail: "almaty",
};
check(
  "менеджер розницы отменяет свою заявку",
  cancelRefusal(CANCEL_ORDER, ROLES.RETAIL_ALMATY, "retail.almaty@x.kz"),
  ""
);
check(
  "чужую — нет",
  cancelRefusal(CANCEL_ORDER, ROLES.RETAIL_REGIONS, "retail.regions@x.kz") !== "",
  true
);
check(
  "обычный менеджер розничную заявку не отменяет",
  cancelRefusal(CANCEL_ORDER, ROLES.MANAGER, "manager@x.kz") !== "",
  true
);
check(
  "отгруженную не отменяет и розница",
  cancelRefusal(
    { ...CANCEL_ORDER, items: [{ shippedQuantity: 10 }] },
    ROLES.RETAIL_ALMATY,
    "retail.almaty@x.kz"
  ) !== "",
  true
);

// --- Заявка на день по магазинам ------------------------------------------

const SHOPS = [
  { clientId: "S1", name: "Абая", city: "Алматы", retail: "almaty", active: true },
  { clientId: "S2", name: "Мега", city: "Алматы", retail: "almaty", active: true },
  { clientId: "S3", name: "Астана-центр", city: "Астана", retail: "regions", active: true },
  { clientId: "S4", name: "Закрытый", city: "Алматы", retail: "almaty", active: false },
  { clientId: "C1", name: "ТОО Цветы", city: "Алматы", retail: "", active: true },
];

const item = (variety: string, grade: string, quantity: number, unitPrice: number) => ({
  flowerType: "rose",
  variety,
  grade,
  quantity,
  unitPrice,
});

const DAY_ORDERS = [
  {
    orderId: "R1",
    clientId: "S1",
    deliveryDate: day(1),
    status: ORDER_STATUSES.NEW,
    retail: "almaty",
    managerConfirmed: true,
    items: [item("Prestige", "60", 200, 150)],
  },
  // Добор в тот же магазин на тот же день — бывает, и обе заявки должны быть видны.
  {
    orderId: "R2",
    clientId: "S1",
    deliveryDate: day(1),
    status: ORDER_STATUSES.NEW,
    retail: "almaty",
    managerConfirmed: false,
    items: [item("Avalanche", "50", 100, 120)],
  },
  // Другой день — в этот лист не идёт.
  {
    orderId: "R3",
    clientId: "S2",
    deliveryDate: day(2),
    status: ORDER_STATUSES.NEW,
    retail: "almaty",
    managerConfirmed: true,
    items: [item("Prestige", "60", 500, 150)],
  },
  // Отменённая не считается.
  {
    orderId: "R4",
    clientId: "S2",
    deliveryDate: day(1),
    status: ORDER_STATUSES.CANCELLED,
    retail: "almaty",
    managerConfirmed: true,
    items: [item("Prestige", "60", 999, 150)],
  },
  // Регион — в лист алматинца не попадает.
  {
    orderId: "R5",
    clientId: "S3",
    deliveryDate: day(1),
    status: ORDER_STATUSES.NEW,
    retail: "regions",
    managerConfirmed: true,
    items: [item("Prestige", "70", 300, 170)],
  },
  // Обычная продажа клиенту — не розница вовсе.
  {
    orderId: "O1",
    clientId: "C1",
    deliveryDate: day(1),
    status: ORDER_STATUSES.NEW,
    retail: "",
    managerConfirmed: true,
    items: [item("Prestige", "60", 1000, 300)],
  },
];

const dayInput = {
  shops: SHOPS,
  orders: DAY_ORDERS,
  date: day(1),
  positionLabel: (variety: string, grade: string) => `${variety} ${grade}`,
  cancelledStatus: ORDER_STATUSES.CANCELLED,
};

const almaty = buildShopDay({ ...dayInput, territories: ["almaty"] });

check(
  "в листе только свои действующие магазины",
  almaty.rows.map((r) => r.clientId),
  ["S1", "S2"]
);
check("добор в тот же магазин виден обеими заявками", almaty.rows[0].orders.length, 2);
check("стебли складываются", almaty.rows[0].stems, 300);
check("сумма по внутренней цене", almaty.rows[0].amount, 200 * 150 + 100 * 120);
// Ради этой строки страница и сделана: забытый магазин остаётся без цветка.
check("магазин без заявки помечен пустым", [almaty.rows[1].clientId, almaty.rows[1].empty], ["S2", true]);
check("отменённая заявка магазин не «закрывает»", almaty.rows[1].stems, 0);
check(
  "итоги: сколько магазинов и скольким оформлено",
  [almaty.totals.shops, almaty.totals.covered, almaty.totals.stems],
  [2, 1, 300]
);

const regions = buildShopDay({ ...dayInput, territories: ["regions"] });
check(
  "региональный менеджер видит только свои магазины",
  regions.rows.map((r) => r.clientId),
  ["S3"]
);
check("и только свои заявки", regions.rows[0].stems, 300);

const both = buildShopDay({ ...dayInput, territories: ["almaty", "regions"] });
check(
  "у РОПа порядок постоянный: сначала Алматы, потом регионы",
  both.rows.map((r) => r.clientId),
  ["S1", "S2", "S3"]
);
check("клиент в лист розницы не попадает", both.rows.some((r) => r.clientId === "C1"), false);

// --- Когда магазину последний раз возили ----------------------------------
//
// Подпись «возили вчера» отвечает на вопрос, который менеджер задаёт себе перед
// оформлением: не отправила ли она этой точке уже сегодня. Через клиентскую
// статистику это не посчитать — магазины оттуда вычищены целиком.

const DELIVERIES = shopDeliveries(
  [
    { clientId: "S1", status: ORDER_STATUSES.NEW, retail: "almaty", deliveryDate: day(-1), createdAt: `${day(-3)}T10:00:00` },
    { clientId: "S1", status: ORDER_STATUSES.NEW, retail: "almaty", deliveryDate: day(-5), createdAt: `${day(-7)}T10:00:00` },
    // Завтрашняя доставка — заявка уже есть, отрицательных дней быть не должно.
    { clientId: "S2", status: ORDER_STATUSES.NEW, retail: "almaty", deliveryDate: day(1), createdAt: `${day(0)}T10:00:00` },
    // Отменённая не считается.
    { clientId: "S3", status: ORDER_STATUSES.CANCELLED, retail: "regions", deliveryDate: day(-1), createdAt: `${day(-2)}T10:00:00` },
    // Обычная продажа клиенту в счёт магазинов не идёт.
    { clientId: "C1", status: ORDER_STATUSES.NEW, retail: "", deliveryDate: day(-1), createdAt: `${day(-2)}T10:00:00` },
  ],
  ORDER_STATUSES.CANCELLED,
  NOW
);

check("берётся САМАЯ свежая доставка, а не последняя в списке", DELIVERIES.get("S1")?.daysSinceLast, 1);
check("и считаются все заявки точки", DELIVERIES.get("S1")?.orders, 2);
check("будущая доставка — это «сегодня», а не минус день", DELIVERIES.get("S2")?.daysSinceLast, 0);
check("отменённая заявка магазин не отмечает", DELIVERIES.has("S3"), false);
check("клиент в счёт магазинов не идёт", DELIVERIES.has("C1"), false);

// --- Сводка за период -----------------------------------------------------

const SUMMARY_ORDERS = DAY_ORDERS.map((o) => ({
  orderId: o.orderId,
  clientId: o.clientId,
  clientName: SHOPS.find((s) => s.clientId === o.clientId)?.name ?? "",
  createdAt: `${day(-1)}T10:00:00`,
  status: o.status,
  retail: o.retail,
  items: o.items,
}));

const summary = buildRetailSummary({
  shops: SHOPS.filter((s) => s.retail).map((s) => ({
    clientId: s.clientId,
    name: s.name,
    city: s.city,
    retail: s.retail,
  })),
  orders: SUMMARY_ORDERS,
  from: day(-30),
  to: day(0),
  territories: ["almaty", "regions"],
  cancelledStatus: ORDER_STATUSES.CANCELLED,
});

check("в сводку идут только розничные и не отменённые", summary.totals.orders, 4);
check(
  "стебли: 200 + 100 + 500 + 300",
  summary.totals.stems,
  200 + 100 + 500 + 300
);
check("магазинов в сводке", summary.totals.shops, 3);
check(
  "разрез по направлениям",
  summary.byTerritory.map((t) => [t.territory, t.stems]),
  [
    ["almaty", 800],
    ["regions", 300],
  ]
);
check(
  "по магазинам — сверху крупнейший",
  summary.byShop.map((s) => s.clientId),
  ["S2", "S1", "S3"]
);
check(
  "заявка вне периода не считается",
  buildRetailSummary({
    shops: [],
    orders: SUMMARY_ORDERS,
    from: day(5),
    to: day(10),
    territories: ["almaty", "regions"],
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  }).totals.orders,
  0
);
check(
  "чужое направление в сводку не попадает",
  buildRetailSummary({
    shops: [],
    orders: SUMMARY_ORDERS,
    from: day(-30),
    to: day(0),
    territories: ["almaty"],
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  }).totals.stems,
  800
);

// --- Два прайса -----------------------------------------------------------

const PRICE_ROWS = [
  { date: day(-1), flowerType: "rose", variety: "", grade: "60", price: 300, kind: "" },
  { date: day(-1), flowerType: "rose", variety: "", grade: "60", price: 150, kind: "retail" },
];
check("неизвестный вид прайса считается клиентским", cleanPriceKind("что-то"), PRICE_KINDS.CLIENT);
check("внутренний опознаётся", cleanPriceKind(" RETAIL "), PRICE_KINDS.RETAIL);
check(
  "клиентская цена и внутренняя не мешают друг другу",
  [
    priceFor(currentPrices(PRICE_ROWS.filter((r) => r.kind === ""), day(0)), "rose", "Prestige", "60"),
    priceFor(
      currentPrices(PRICE_ROWS.filter((r) => r.kind === "retail"), day(0)),
      "rose",
      "Prestige",
      "60"
    ),
  ],
  [300, 150]
);

// --- Деньги: розницы в них нет вовсе --------------------------------------

const users = [
  { email: "m1@x.kz", name: "Айгерим", role: "manager", farm: null, active: true },
  { email: "r1@x.kz", name: "Розница", role: "retail_almaty", farm: null, active: true },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/users").listUsers>>;

function fullOrder(
  orderId: string,
  managerEmail: string,
  retail: string,
  quantity: number,
  unitPrice: number,
  paidAmount: number
) {
  const total = quantity * unitPrice;
  return {
    orderId,
    createdAt: `${day(-3)}T10:00:00`,
    managerEmail,
    clientName: retail ? "Наш магазин" : "ТОО Цветы",
    clientPhone: "",
    deliveryDate: day(-2),
    status: ORDER_STATUSES.NEW,
    notes: "",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: paidAmount >= total && paidAmount > 0,
    paidAt: "",
    paymentMethod: "",
    accountantEmail: "",
    paidAmount,
    paidRoseFarm: 0,
    paidEsentai: 0,
    promisedAt: "",
    collectionNote: "",
    clientId: retail ? "S1" : "C1",
    retail,
    totalAmount: total,
    items: [
      {
        orderId,
        itemId: `${orderId}-I1`,
        flowerType: "rose",
        variety: "Prestige",
        grade: "60",
        quantity,
        unitPrice,
        shippedQuantity: 0,
      },
    ],
  };
}

const MONEY_ORDERS = [
  fullOrder("SALE", "m1@x.kz", "", 1000, 300, 0),
  // Ровно та же по объёму заявка, но в наш магазин: ни выручки, ни долга.
  fullOrder("MOVE", "r1@x.kz", "almaty", 1000, 150, 0),
];

async function main() {
  const snapshot = await getFinanceSnapshot("month", day(0), NOW, {
    orders: MONEY_ORDERS as never,
    users,
  });
  check(
    "у бухгалтера видна только продажа наружу",
    snapshot.orders.map((r) => r.orderId),
    ["SALE"]
  );
  check("долг считается только по ней", snapshot.totals.unpaidAmount, 300_000);
  check(
    "магазин не попадает в список звонков",
    snapshot.calls.some((c) => c.orderId === "MOVE"),
    false
  );

  const board = await getLeaderboard("month", day(0), NOW, {
    orders: MONEY_ORDERS as never,
    users,
    plans: new Map(),
  });
  check(
    "в рейтинге продаж менеджера розницы нет",
    board.rows.some((r) => r.managerEmail === "r1@x.kz"),
    false
  );

  const stats = buildClientStats({
    clients: [
      { clientId: "C1", name: "ТОО Цветы", city: "Алматы", retail: "" },
      { clientId: "S1", name: "Наш магазин", city: "Алматы", retail: "almaty" },
    ] as never,
    orders: MONEY_ORDERS as never,
    nameByEmail: new Map(),
    now: NOW,
    positionLabel: (f, g) => `${f} ${g}`,
  });
  check(
    "в клиентской базе магазина нет",
    stats.rows.map((r) => r.client.clientId),
    ["C1"]
  );
  check("и его заявка не в выручке", stats.totals.revenue, 300_000);
  check(
    "заявка магазина не считается «заявкой без клиента»",
    stats.ordersWithoutClient,
    0
  );

  console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
