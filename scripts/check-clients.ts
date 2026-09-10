/*
 * Клиентская база: расчёты и разрезы.
 *
 * Тут легко ошибиться тихо: посчитать переплату выручкой, взять в средний чек
 * отменённую заявку, назвать «отвалившимся» клиента, который вообще ещё ничего
 * не заказывал, или сложить доли так, что они не дадут ста процентов.
 *
 * Запуск: npx tsx scripts/check-clients.ts
 */
import { buildClientStats } from "../src/lib/clientStats";
import { kaspiFieldsFor, kaspiTargetsFor, orderForPicker } from "../src/lib/clientPick";
import { CLIENT_SLEEPING_DAYS, ORDER_STATUSES } from "../src/lib/constants";
import type { Client, OrderWithItems } from "../src/lib/types";

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

function client(over: Partial<Client> & { clientId: string; name: string }): Client {
  return {
    createdAt: day(-100),
    city: "Алматы",
    shopName: "",
    clientType: "Розничный магазин",
    contactPerson: "",
    phone: "",
    messenger: "",
    address: "",
    paymentTerms: "По факту",
    paymentMethod: "Каспи",
    kaspiRoseFarm: "",
    kaspiEsentai: "",
    kaspiClient: "",
    source: "Сами нашли",
    note: "",
    managerEmail: "aliya@x.kz",
    active: true,
    ...over,
  };
}

let seq = 0;
function order(over: {
  clientId: string;
  createdAt: string;
  amount: number;
  paidAmount?: number;
  status?: string;
  stems?: number;
  grade?: string;
}): OrderWithItems {
  seq++;
  const stems = over.stems ?? 100;
  return {
    orderId: `ORD-${seq}`,
    createdAt: `${over.createdAt}T10:00:00`,
    managerEmail: "aliya@x.kz",
    clientId: over.clientId,
    clientName: "снимок",
    clientPhone: "",
    deliveryDate: over.createdAt,
    status: (over.status ?? ORDER_STATUSES.NEW) as OrderWithItems["status"],
    notes: "",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: (over.paidAmount ?? 0) >= over.amount,
    paidAt: "",
    paymentMethod: "Каспи",
    accountantEmail: "",
    paidAmount: over.paidAmount ?? 0,
    promisedAt: "",
    collectionNote: "",
    totalAmount: over.amount,
    items: [
      {
        itemId: `ORD-${seq}-I1`,
        orderId: `ORD-${seq}`,
        flowerType: "rose",
        variety: "Prestige",
        grade: over.grade ?? "60 см",
        quantity: stems,
        unitPrice: over.amount / stems,
        shippedQuantity: 0,
      },
    ],
  } as unknown as OrderWithItems;
}

const CLIENTS: Client[] = [
  client({ clientId: "C1", name: "Цветы 24", city: "Алматы" }),
  client({ clientId: "C2", name: "Магнолия", city: "Караганда", managerEmail: "emil@x.kz" }),
  client({ clientId: "C3", name: "Новичок", city: "Астана" }),
  client({ clientId: "C4", name: "Пропавший", city: "Алматы" }),
];

const ORDERS: OrderWithItems[] = [
  // C1: три заявки, одна с переплатой, одна отменённая (не считается).
  order({ clientId: "C1", createdAt: day(-2), amount: 300_000, paidAmount: 300_000 }),
  order({ clientId: "C1", createdAt: day(-20), amount: 200_000, paidAmount: 250_000 }),
  order({ clientId: "C1", createdAt: day(-5), amount: 999_999, status: ORDER_STATUSES.CANCELLED }),
  // C2: одна заявка, оплачена наполовину.
  order({ clientId: "C2", createdAt: day(-1), amount: 100_000, paidAmount: 40_000 }),
  // C4: покупал давно и замолчал.
  order({ clientId: "C4", createdAt: day(-CLIENT_SLEEPING_DAYS - 5), amount: 50_000, paidAmount: 50_000 }),
  // Заявка без карточки — так выглядят старые, заведённые до появления базы.
  order({ clientId: "", createdAt: day(-3), amount: 77_000, paidAmount: 0 }),
];

const stats = buildClientStats({
  clients: CLIENTS,
  orders: ORDERS,
  nameByEmail: new Map([
    ["aliya@x.kz", "Алия"],
    ["emil@x.kz", "Эмиль"],
  ]),
  now: NOW,
  positionLabel: (t, g) => `${t} ${g}`,
});

const byId = new Map(stats.rows.map((r) => [r.client.clientId, r]));
const c1 = byId.get("C1")!;
const c2 = byId.get("C2")!;
const c3 = byId.get("C3")!;
const c4 = byId.get("C4")!;

// --- Заявки и деньги -------------------------------------------------------

check("отменённая заявка не считается", c1.orders, 2);
check("выручка клиента", c1.revenue, 500_000);
check("переплата не идёт в выручку", c1.paid, 500_000);
check("у клиента без долга долг ноль", c1.debt, 0);
check("средний чек", c1.avgCheck, 250_000);
check("частичная оплата — долг остаток", [c2.paid, c2.debt], [40_000, 60_000]);

// --- Кто молчит, кто ещё не начинал ---------------------------------------

check("новая карточка без заказов", [c3.orders, c3.neverOrdered, c3.sleeping], [0, true, false]);
check("давно не заказывал — молчит", c4.sleeping, true);
check("заказывал на днях — не молчит", c1.sleeping, false);
check("дней с последнего заказа", c1.daysSinceLast, 2);
check("первый и последний заказ", [c1.firstOrderDate, c1.lastOrderDate], [day(-20), day(-2)]);

// --- Итоги -----------------------------------------------------------------

check("всего клиентов", stats.totals.clients, 4);
check("молчащих", stats.totals.sleepingClients, 1);
check("без заказов", stats.totals.neverOrderedClients, 1);
check("заявок всего (без отменённой и без бесхозной)", stats.totals.orders, 4);
check("выручка всего", stats.totals.revenue, 650_000);
check("долг всего", stats.totals.debt, 60_000);
check("заявок без карточки", stats.ordersWithoutClient, 1);
check(
  "средний чек по базе",
  Math.round(stats.totals.avgCheck),
  Math.round(650_000 / 4)
);
check("выручка на клиента", Math.round(stats.totals.revenuePerClient), Math.round(650_000 / 4));

// Клиентов всего четверо, значит три крупнейших дают всё, кроме самого мелкого.
check("доля трёх крупнейших", Math.round(stats.totals.top3Share), 100);

// --- Разрезы ---------------------------------------------------------------

check(
  "по менеджерам: имена и выручка",
  stats.byManager.map((g) => [g.label, g.revenue]),
  [
    ["Алия", 550_000],
    ["Эмиль", 100_000],
  ]
);
check(
  "по менеджерам: число клиентов",
  stats.byManager.map((g) => [g.label, g.clients]),
  [
    ["Алия", 3],
    ["Эмиль", 1],
  ]
);
check(
  "доли по менеджерам дают 100 %",
  Math.round(stats.byManager.reduce((s, g) => s + g.share, 0)),
  100
);
check(
  "по городам",
  stats.byCity.map((g) => [g.label, g.clients, g.revenue]),
  [
    ["Алматы", 2, 550_000],
    ["Караганда", 1, 100_000],
    ["Астана", 1, 0],
  ]
);
check(
  "сумма выручки по городам равна общей",
  stats.byCity.reduce((s, g) => s + g.revenue, 0),
  stats.totals.revenue
);
check(
  "сумма клиентов по городам равна общей",
  stats.byCity.reduce((s, g) => s + g.clients, 0),
  stats.totals.clients
);

// --- Что берёт клиент ------------------------------------------------------

check("самая частая позиция", c1.topPosition, "rose 60 см");
check("у клиента без заказов позиции нет", c3.topPosition, "");

// --- Порядок в списке ------------------------------------------------------

check(
  "список отсортирован по выручке",
  stats.rows.map((r) => r.client.clientId),
  ["C1", "C2", "C4", "C3"]
);

// --- Пустая база не роняет расчёт ------------------------------------------

const empty = buildClientStats({
  clients: [],
  orders: [],
  nameByEmail: new Map(),
  now: NOW,
  positionLabel: (t, g) => `${t} ${g}`,
});
check(
  "пустая база: нули без деления на ноль",
  [empty.totals.clients, empty.totals.avgCheck, empty.totals.top3Share, empty.byCity.length],
  [0, 0, 0, 0]
);

// --- Порядок в подборщике заявки -------------------------------------------
//
// Менеджер девять раз из десяти оформляет заявку старому клиенту, с которым
// работал недавно. Алфавит для этого бесполезен.

const CANDIDATES = [
  { name: "Азия-Флора", mine: true, orders: 12, daysSinceLast: 200 },
  { name: "Вчерашний", mine: true, orders: 3, daysSinceLast: 1 },
  { name: "Чужой свежий", mine: false, orders: 5, daysSinceLast: 0 },
  { name: "Без заказов", mine: true, orders: 0, daysSinceLast: -1 },
  { name: "Апрельский", mine: true, orders: 2, daysSinceLast: 1 },
];

check(
  "свои недавние сверху, чужие ниже, без заказов в конце",
  orderForPicker(CANDIDATES).map((c) => c.name),
  ["Апрельский", "Вчерашний", "Азия-Флора", "Без заказов", "Чужой свежий"]
);
check(
  "при равной свежести — по алфавиту, список не прыгает",
  orderForPicker(CANDIDATES).slice(0, 2).map((c) => c.name),
  ["Апрельский", "Вчерашний"]
);
check("пустой список не падает", orderForPicker([]).length, 0);

// --- Kaspi Pay --------------------------------------------------------------
//
// Компанию НЕ выбирают руками: она следует из цветка. Номер вписывается
// свободно, потому что каспи-счетов бывает больше двух и появляются новые.

check(
  "при оплате Каспи реквизиты сохраняются",
  kaspiFieldsFor("Каспи", {
    kaspiRoseFarm: " +7 701 ",
    kaspiEsentai: "+7 702",
    kaspiClient: "+7 777",
  }),
  { kaspiRoseFarm: "+7 701", kaspiEsentai: "+7 702", kaspiClient: "+7 777" }
);
check(
  "при наличных каспи-поля стираются",
  kaspiFieldsFor("Наличные", { kaspiRoseFarm: "+7 701", kaspiClient: "+7 777" }),
  { kaspiRoseFarm: "", kaspiEsentai: "", kaspiClient: "" }
);
check(
  "при оплате по реквизитам — тоже",
  kaspiFieldsFor("Оплата по реквизитам", { kaspiRoseFarm: "+7 701" }),
  { kaspiRoseFarm: "", kaspiEsentai: "", kaspiClient: "" }
);
check(
  "неизвестный способ оплаты каспи-поля не открывает",
  kaspiFieldsFor("Биткоин", { kaspiRoseFarm: "+7 701" }),
  { kaspiRoseFarm: "", kaspiEsentai: "", kaspiClient: "" }
);

const PAYER = {
  paymentMethod: "Каспи",
  kaspiRoseFarm: "+7 701 111 11 11",
  kaspiEsentai: "+7 702 222 22 22",
  kaspiClient: "+7 777 333 33 33",
};

check(
  "роза — счёт от Rose Farm",
  kaspiTargetsFor(PAYER, ["rose"]).map((t) => [t.farmLabel, t.account]),
  [["Rose Farm", "+7 701 111 11 11"]]
);
check(
  "эустома — тоже Rose Farm",
  kaspiTargetsFor(PAYER, ["eustoma"]).map((t) => t.farm),
  ["rose_farm"]
);
check(
  "хризантема — счёт от Есентая",
  kaspiTargetsFor(PAYER, ["chrysanthemum"]).map((t) => [t.farmLabel, t.account]),
  [["Есентай Агро Хим", "+7 702 222 22 22"]]
);
check(
  "смешанная заявка — два счёта, в порядке позиций",
  kaspiTargetsFor(PAYER, ["chrysanthemum", "rose", "rose"]).map((t) => t.farm),
  ["esentai", "rose_farm"]
);
check(
  "одна компания не дублируется",
  kaspiTargetsFor(PAYER, ["rose", "eustoma", "rose"]).length,
  1
);
check(
  "незаполненный реквизит виден как пустой, а не пропадает",
  kaspiTargetsFor({ paymentMethod: "Каспи" }, ["rose"]).map((t) => t.account),
  [""]
);
check(
  "клиент платит не каспи — счетов нет",
  kaspiTargetsFor({ ...PAYER, paymentMethod: "Наличные" }, ["rose"]).length,
  0
);
check(
  "неизвестный цветок счёт не создаёт",
  kaspiTargetsFor(PAYER, ["tulip"]).length,
  0
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
