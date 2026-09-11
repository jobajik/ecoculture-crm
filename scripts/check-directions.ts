/*
 * Оптовые отгрузки по регионам: план РОПа против факта.
 *
 * Здесь три места, где ошибка была бы дорогой и тихой.
 *
 * Первое — собственная розница. Карточки наших магазинов в регионах называются
 * «Розница, Астана» и «Розница, Семей», а направления в плане — «Астана» и
 * «Семей». Стоит забыть фильтр, и внутреннее перемещение цветка в свой же
 * магазин превратится в выполнение плана по региону: план «сделан», а продажи
 * не выросли ни на тенге.
 *
 * Второе — направление как закрытый список. Опечатка в ячейке не должна
 * заводить новое направление на одну заявку: тогда сумма по направлениям
 * перестанет сходиться, а найти лишнюю строку будет негде.
 *
 * Третье — права. Направление ставит РОП; если бы его мог поставить кто угодно,
 * заявку по Алматы можно было бы записать в регион и «сделать» план.
 *
 * Запуск: npx tsx scripts/check-directions.ts
 */
import {
  buildDirectionFact,
  canSeeRegionSales,
  canSetDirection,
  cleanDirection,
  countsAsWholesale,
  directionForCity,
  directionRefusal,
  ordersMissingDirection,
  type DirectionFactOrder,
  type DirectionPlanRow,
} from "../src/lib/direction";
import { ORDER_STATUSES, ROLES, SHIPMENT_DIRECTIONS } from "../src/lib/constants";

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

// --- Закрытый список --------------------------------------------------------

check("известное направление проходит", cleanDirection("Астана"), "Астана");
check("регистр не мешает", cleanDirection("астана"), "Астана");
check("лишние пробелы не мешают", cleanDirection("  Караганда "), "Караганда");
check("дефис и пробел равнозначны", cleanDirection("Усть Каменогорск"), "Усть-Каменогорск");
check("неизвестное превращается в пустое (грабли 1.10)", cleanDirection("Ташкент"), "");
check("пустое остаётся пустым", cleanDirection(""), "");
check("Алматы в списке нет — так решил владелец", SHIPMENT_DIRECTIONS.includes("Алматы"), false);

// --- Подстановка по городу --------------------------------------------------

check("город совпал с направлением", directionForCity("Астана"), "Астана");
check("Нур-Султан — это Астана", directionForCity("Нур-Султан"), "Астана");
check("Семипалатинск — это Семей", directionForCity("Семипалатинск"), "Семей");
check("Оскемен — это Усть-Каменогорск", directionForCity("Оскемен"), "Усть-Каменогорск");
check("Бишкек — это Киргизия", directionForCity("бишкек"), "Киргизия");
check("Алматы направления не даёт", directionForCity("Алматы"), "");
check("незнакомый город направления не даёт", directionForCity("Тараз"), "");
check("пустой город не падает", directionForCity(""), "");
// Угадывать по первым буквам нельзя: так «Кара-Балта» стала бы «Карагандой».
check("похожий, но другой город не подставляется", directionForCity("Кара-Балта"), "");

// --- Права ------------------------------------------------------------------

check("РОП ставит направление", canSetDirection(ROLES.SALES_HEAD), true);
check("администратор тоже", canSetDirection(ROLES.ADMIN), true);
check("менеджер не ставит", canSetDirection(ROLES.MANAGER), false);
check("зав. складом не ставит", canSetDirection(ROLES.WAREHOUSE), false);
check("пустая роль не ставит (грабли 1.10)", canSetDirection(""), false);
check("раздел «Регионы» видит РОП", canSeeRegionSales(ROLES.SALES_HEAD), true);
check("менеджер раздел не видит", canSeeRegionSales(ROLES.MANAGER), false);

check(
  "менеджеру направление поставить нельзя",
  directionRefusal({ role: ROLES.MANAGER, direction: "Астана", isShop: false }) !== "",
  true
);
check(
  "но заявка без направления у менеджера проходит",
  directionRefusal({ role: ROLES.MANAGER, direction: "", isShop: false }),
  ""
);
check(
  "РОПу можно",
  directionRefusal({ role: ROLES.SALES_HEAD, direction: "Астана", isShop: false }),
  ""
);
check(
  "у заявки в наш магазин направления отгрузки не бывает",
  directionRefusal({ role: ROLES.SALES_HEAD, direction: "Астана", isShop: true }) !== "",
  true
);
check(
  "неизвестное направление не проходит",
  directionRefusal({ role: ROLES.SALES_HEAD, direction: "Ташкент", isShop: false }) !== "",
  true
);

// --- Что идёт в оптовый счёт ------------------------------------------------

check(
  "обычная заявка идёт",
  countsAsWholesale({ status: ORDER_STATUSES.NEW, retail: "" }, ORDER_STATUSES.CANCELLED),
  true
);
check(
  "отменённая не идёт",
  countsAsWholesale({ status: ORDER_STATUSES.CANCELLED, retail: "" }, ORDER_STATUSES.CANCELLED),
  false
);
check(
  "заявка в наш магазин не идёт — это перемещение, а не продажа",
  countsAsWholesale({ status: ORDER_STATUSES.NEW, retail: "regions" }, ORDER_STATUSES.CANCELLED),
  false
);

// --- План против факта ------------------------------------------------------

const PLANS: DirectionPlanRow[] = [
  { period: "2026-09-W2", direction: "Астана", targetStems: 1000, targetAmount: 500_000 },
  { period: "2026-09-W2", direction: "Караганда", targetStems: 500, targetAmount: 250_000 },
  { period: "2026-09-W3", direction: "Астана", targetStems: 800, targetAmount: 400_000 },
  // Чужая неделя в счёт не идёт.
  { period: "2026-10-W1", direction: "Астана", targetStems: 9999, targetAmount: 1 },
];

const ORDERS: DirectionFactOrder[] = [
  {
    orderId: "O-1",
    clientName: "Цветы Астаны",
    deliveryDate: "2026-09-08",
    status: ORDER_STATUSES.NEW,
    direction: "Астана",
    managerEmail: "rop@ecoculture.kz",
    items: [{ quantity: 600, shippedQuantity: 600, unitPrice: 500 }],
  },
  {
    orderId: "O-2",
    clientName: "Букет Караганды",
    deliveryDate: "2026-09-10",
    status: ORDER_STATUSES.NEW,
    direction: "Караганда",
    managerEmail: "rop@ecoculture.kz",
    items: [{ quantity: 500, shippedQuantity: 200, unitPrice: 400 }],
  },
  {
    // Наш собственный магазин в Астане: стебли уехали, но это не продажа.
    orderId: "O-3",
    clientName: "Розница, Астана",
    deliveryDate: "2026-09-09",
    status: ORDER_STATUSES.NEW,
    direction: "Астана",
    retail: "regions",
    managerEmail: "sklad.rose@ecoculture.kz",
    items: [{ quantity: 3000, shippedQuantity: 3000, unitPrice: 100 }],
  },
  {
    orderId: "O-4",
    clientName: "Отменённая",
    deliveryDate: "2026-09-09",
    status: ORDER_STATUSES.CANCELLED,
    direction: "Астана",
    managerEmail: "rop@ecoculture.kz",
    items: [{ quantity: 5000, shippedQuantity: 0, unitPrice: 500 }],
  },
  {
    orderId: "O-5",
    clientName: "Алматинский клиент",
    deliveryDate: "2026-09-09",
    status: ORDER_STATUSES.NEW,
    direction: "",
    managerEmail: "emil@ecoculture.kz",
    items: [{ quantity: 400, shippedQuantity: 400, unitPrice: 300 }],
  },
  {
    // Заявка в регион, заведённая менеджером: направления нет.
    orderId: "O-6",
    clientName: "Семейский салон",
    deliveryDate: "2026-09-11",
    status: ORDER_STATUSES.NEW,
    direction: "",
    managerEmail: "emil@ecoculture.kz",
    items: [{ quantity: 200, shippedQuantity: 0, unitPrice: 350 }],
  },
];

const WEEK2 = { from: "2026-09-07", to: "2026-09-13", periods: ["2026-09-W2"] };

const fact = buildDirectionFact({
  orders: ORDERS,
  plans: PLANS,
  from: WEEK2.from,
  to: WEEK2.to,
  planPeriods: WEEK2.periods,
  cancelledStatus: ORDER_STATUSES.CANCELLED,
});

check("план за неделю", fact.planStems, 1500);
check("заказано за неделю", fact.orderedStems, 1100);
check("отгружено за неделю", fact.shippedStems, 800);
check("заявок в счёте", fact.orders, 2);
check("сумма по направлениям", fact.amount, 600 * 500 + 500 * 400);
check("выполнение плана, %", Math.round(fact.donePercent ?? -1), 73);

const rows = fact.groups.flatMap((g) => g.rows);
const astana = rows.find((r) => r.direction === "Астана");
check("Астана: наш магазин в факт не попал", astana?.orderedStems, 600);
check("Астана: отменённая не попала", astana?.orders, 1);
check("Астана: план недели", astana?.planStems, 1000);

const karaganda = rows.find((r) => r.direction === "Караганда");
check("Караганда: заказано", karaganda?.orderedStems, 500);
check("Караганда: из них отгружено меньше", karaganda?.shippedStems, 200);

const semei = rows.find((r) => r.direction === "Семей");
check("Семей: ни плана, ни факта — выполнение прочерк, а не ноль", semei?.donePercent, null);

check(
  "алматинская заявка в регионы не попала",
  rows.reduce((s, r) => s + r.orderedStems, 0),
  1100
);

// Блоки направлений: сумма по блокам равна общему итогу — иначе на странице
// «Всего» разошлось бы с тем, что видно глазами.
check(
  "сумма блоков равна итогу",
  fact.groups.reduce((s, g) => s + g.orderedStems, 0),
  fact.orderedStems
);

// Месяц целиком — это просто сумма своих недель, без отдельного расчёта.
const monthFact = buildDirectionFact({
  orders: ORDERS,
  plans: PLANS,
  from: "2026-09-01",
  to: "2026-09-30",
  planPeriods: ["2026-09-W1", "2026-09-W2", "2026-09-W3", "2026-09-W4", "2026-09-W5"],
  cancelledStatus: ORDER_STATUSES.CANCELLED,
});
check("месячный план = сумма недель", monthFact.planStems, 1000 + 500 + 800);
check("чужой месяц в план не попал", monthFact.planStems < 9999, true);
// Заявка от 11 сентября направления не несёт, поэтому в факт по регионам она
// не идёт — её и показывает список «похоже на регион, но направление не стоит».
check("заявка без направления в факт не попала", monthFact.orderedStems, 1100);

check(
  "пустые данные не роняют расчёт",
  buildDirectionFact({
    orders: [],
    plans: [],
    from: "2026-09-01",
    to: "2026-09-30",
    planPeriods: [],
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  }).donePercent,
  null
);

// --- Заявки без направления -------------------------------------------------

const cityByOrder = new Map<string, string>([
  ["O-1", "Астана"],
  ["O-2", "Караганда"],
  ["O-3", "Астана"],
  ["O-4", "Астана"],
  ["O-5", "Алматы"],
  ["O-6", "Семипалатинск"],
]);

const missing = ordersMissingDirection({
  orders: ORDERS,
  cityByOrder,
  from: "2026-09-01",
  to: "2026-09-30",
  cancelledStatus: ORDER_STATUSES.CANCELLED,
});
check("нашлась ровно одна заявка без направления", missing.map((m) => m.orderId), ["O-6"]);
check("и направление предложено по городу", missing[0]?.suggested, "Семей");
check(
  "алматинская заявка в список не попала — ей направление и не нужно",
  missing.some((m) => m.orderId === "O-5"),
  false
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
