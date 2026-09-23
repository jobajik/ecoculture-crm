/**
 * «Что у вас сегодня» — блок в начале главной.
 *
 * Проверяем не оформление, а цифры: каждая из них — повод что-то сделать, и
 * ошибка здесь дороже, чем в отчёте. Отдельно следим за тем, что у каждой роли
 * блок отвечает на ЕЁ вопрос, а не на чужой.
 */
import { homeFocus, type FocusOrder } from "../src/lib/homeFocus";
import { ROLES } from "../src/lib/constants";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(
    `${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

const TODAY = "2026-09-14";
const day = (shift: number) => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() + shift);
  return d.toISOString().slice(0, 10);
};

function order(p: Partial<FocusOrder> & { orderId: string }): FocusOrder {
  return {
    managerEmail: "emil@x.kz",
    status: "new",
    deliveryDate: day(1),
    createdAt: `${day(-2)}T10:00:00`,
    managerConfirmed: true,
    paid: true,
    paidAmount: 100_000,
    totalAmount: 100_000,
    ...p,
  };
}

const value = (f: ReturnType<typeof homeFocus>, label: string) =>
  f?.stats.find((s) => s.label === label)?.value;

// --- Менеджер --------------------------------------------------------------
const managerOrders: FocusOrder[] = [
  // Обе галочки — склад может собирать.
  order({ orderId: "A" }),
  // Не оплачена — ждёт бухгалтера, а не менеджера.
  order({ orderId: "B", paid: false, paidAmount: 0 }),
  // Не подтверждена — ждёт САМОГО менеджера.
  order({ orderId: "C", managerConfirmed: false }),
  // Без даты доставки: в дневной лист сборки не попадёт вовсе.
  order({ orderId: "D", deliveryDate: "" }),
  // Отгружена — открытой не считается.
  order({ orderId: "E", status: "shipped" }),
  // Отменена — тем более.
  order({ orderId: "F", status: "cancelled" }),
  // Чужая заявка: в свои цифры не идёт.
  order({ orderId: "G", managerEmail: "kto@to.kz" }),
];

const m = homeFocus({
  role: ROLES.MANAGER,
  email: "EMIL@x.kz", // регистр почты не должен ничего ломать
  orders: managerOrders,
  todayKey: TODAY,
});

check("менеджеру блок показывается выше склада", m?.aboveStock, true);
check("можно собирать — только с обеими галочками", value(m, "Можно собирать"), "2");
check("ждут галочки менеджера", value(m, "Ждут вашей галочки"), "1");
check("без даты доставки — строкой «требует внимания»", m?.attention?.[0]?.label, "Без даты доставки: 1");
check("всего открытых — без отгруженных и отменённых", value(m, "Всего открытых"), "4");
check("у менеджера есть кнопка новой заявки", m?.action?.href, "/orders/new");
check(
  "заявка без даты помечена тревожно — она выпадает из листа сборки",
  m?.attention?.[0]?.tone,
  "critical"
);
check("плитка ведёт в отфильтрованный список, а не в общий", m?.stats.find((s) => s.label === "Ждут вашей галочки")?.href, "/orders?stage=wait_confirm");

// Опоздание: доставка прошла, заявка не отгружена.
const lateM = homeFocus({
  role: ROLES.MANAGER,
  email: "emil@x.kz",
  orders: [
    order({ orderId: "L1", deliveryDate: day(-3), items: [{ quantity: 10, shippedQuantity: 0 }] }),
    order({ orderId: "L2", deliveryDate: day(-3), items: [{ quantity: 10, shippedQuantity: 10 }] }),
    order({ orderId: "L3", status: "in_progress", deliveryDate: day(-1), items: [{ quantity: 10, shippedQuantity: 4 }] }),
  ],
  todayKey: TODAY,
});
check("опаздывают — не отгруженные с прошедшей доставкой (частичные тоже)", value(lateM, "Опаздывают"), "2");
check("частично отгруженная — открытая (раньше выпадала из счёта)", value(lateM, "Всего открытых"), "2");

// Всё в порядке — ничего не мигает красным.
const calm = homeFocus({
  role: ROLES.MANAGER,
  email: "emil@x.kz",
  orders: [order({ orderId: "A" })],
  todayKey: TODAY,
});
check(
  "когда всё хорошо, тревожных плиток нет",
  calm?.stats.filter((s) => s.tone === "critical" || s.tone === "warn").length,
  0
);

// --- Бухгалтер и РОП -------------------------------------------------------
const moneyOrders: FocusOrder[] = [
  // Без даты доставки: возраст долга считается от дня ОФОРМЛЕНИЯ — как в
  // finance.ts. Иначе такая заявка тихо выпадала бы из просрочки, и на главной
  // стояло бы одно число, а на странице долгов другое.
  order({
    orderId: "NODATE",
    paid: false,
    paidAmount: 0,
    totalAmount: 90_000,
    deliveryDate: "",
    createdAt: `${day(-9)}T10:00:00`,
  }),
  // Долг 200 000, доставка шесть дней назад — просрочен.
  order({ orderId: "OLD", paid: false, paidAmount: 0, totalAmount: 200_000, deliveryDate: day(-6) }),
  // Долг 50 000, вчерашняя доставка — срок ещё не вышел.
  order({ orderId: "NEW", paid: false, paidAmount: 0, totalAmount: 50_000, deliveryDate: day(-1) }),
  // Предоплата: долг — ОСТАТОК, а не вся сумма.
  order({ orderId: "PART", paid: false, paidAmount: 300_000, totalAmount: 800_000, deliveryDate: day(-6) }),
  // Отменённая в долг не идёт.
  order({ orderId: "CANC", status: "cancelled", paid: false, paidAmount: 0, totalAmount: 999_000 }),
  // Наш магазин: счёта нет, ждать оплату не от кого.
  order({ orderId: "SHOP", retail: "almaty", paid: false, paidAmount: 0, totalAmount: 70_000 }),
  // Копеечный остаток долгом не считается.
  order({ orderId: "KOP", paid: false, paidAmount: 99_999.5, totalAmount: 100_000 }),
];

const acc = homeFocus({
  role: ROLES.ACCOUNTANT,
  email: "buh@x.kz",
  orders: moneyOrders,
  todayKey: TODAY,
});
// Пробел в числах — НЕРАЗРЫВНЫЙ: так его ставит toLocaleString("ru-RU"),
// и сравнивать надо с ним же, иначе проверка падает на невидимом различии.
const money = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
check("долг — сумма остатков", value(acc, "Должны нам"), money(840_000));
check("просрочено — только по просроченным заявкам", value(acc, "Просрочено"), money(790_000));
check("заявка без даты доставки считается от дня оформления", value(acc, "Заявок в просрочке"), "3");

check("бухгалтеру блок выше склада", acc?.aboveStock, true);
check("бухгалтеру склад на главной не показывается", acc?.showStock, false);
check("бухгалтеру кнопки новой заявки нет", acc?.action, undefined);

const rop = homeFocus({
  role: ROLES.SALES_HEAD,
  email: "rop@x.kz",
  orders: moneyOrders,
  todayKey: TODAY,
});
check("у РОПа те же деньги, что у бухгалтера", value(rop, "Должны нам всего"), money(840_000));
check("РОП видит просрочку", value(rop, "Просрочено"), money(790_000));
check("и написано, что оплаты отмечает бухгалтер", rop?.subtitle.includes("бухгалтер"), true);

// --- Зав. складом ----------------------------------------------------------
const whOrders: FocusOrder[] = [
  order({ orderId: "R1", deliveryDate: TODAY }),
  order({ orderId: "R2", deliveryDate: day(2) }),
  order({ orderId: "W1", paid: false, paidAmount: 0, deliveryDate: TODAY }),
];
const wh = homeFocus({
  role: ROLES.WAREHOUSE,
  email: "sklad@x.kz",
  orders: whOrders,
  todayKey: TODAY,
});
check("можно отгружать", value(wh, "Можно отгружать"), "2");
check("у склада строка очереди над сводкой", wh?.strip?.text, "К отгрузке: 2");
check("ждут", value(wh, "Ждут"), "1");
check("доставка сегодня — считает и неготовые", value(wh, "Доставка сегодня"), "2");
check(
  "у зав. складом сводка склада остаётся первой — это её работа",
  wh?.aboveStock,
  false
);
check("кнопка ведёт в лист сборки", wh?.action?.href, "/warehouse/picklist");

// --- Роли без своего блока -------------------------------------------------
// --- Администратор ---------------------------------------------------------
// Владельцу нужен не свой участок, а то, что стоит на месте.
const adm = homeFocus({ role: ROLES.ADMIN, email: "a@x.kz", orders: moneyOrders.concat(whOrders), todayKey: TODAY });
check("у админа блок «Требует внимания»", adm?.title, "Требует внимания");
check("админ видит просрочку", value(adm, "Просрочено"), money(790_000));
check("просрочка долгов — в списке внимания со ссылкой на долги", adm?.attention?.find((a) => a.href === "/finance/debts")?.tone, "critical");
const admX = homeFocus({
  role: ROLES.ADMIN,
  email: "a@x.kz",
  orders: [order({ orderId: "OVER", paidAmount: 640_000, totalAmount: 100_000 })],
  todayKey: TODAY,
  extras: { expiredStems: 5000, stockStems: 20000, openClaims: 2 },
});
check(
  "переплата, залежавшийся склад и рекламации — в списке внимания",
  admX?.attention?.map((a) => a.href),
  ["/warehouse/writeoff?mode=recount", "/finance", "/finance/claims"]
);
check("25 % склада просрочено — красным", admX?.attention?.[0]?.tone, "critical");
check(
  "пустая база у админа ничего не красит",
  homeFocus({ role: ROLES.ADMIN, email: "a@x.kz", orders: [], todayKey: TODAY })?.stats.every(
    (s) => s.tone !== "critical" && s.tone !== "warn"
  ),
  true
);
check("у агронома тоже", homeFocus({ role: ROLES.AGRONOMIST, email: "a@x.kz", orders: [], todayKey: TODAY }), null);
check("без роли блока нет", homeFocus({ role: undefined, email: "", orders: [], todayKey: TODAY }), null);

// Пустая база не должна падать и не должна пугать.
const empty = homeFocus({ role: ROLES.ACCOUNTANT, email: "b@x.kz", orders: [], todayKey: TODAY });
check("пустая база: долг ноль", value(empty, "Должны нам"), money(0));
check("пустая база: ничего не красное", empty?.stats.every((s) => s.tone !== "critical"), true);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
