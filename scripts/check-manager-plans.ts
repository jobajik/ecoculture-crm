/*
 * План продаж менеджерам, разбитый по цветку.
 *
 * Опасных мест здесь ровно два, и оба про одно и то же — про ДВА ЧИСЛА ОБ
 * ОДНОМ И ТОМ ЖЕ МЕСЯЦЕ.
 *
 * Первое: итог по менеджеру не хранится, а складывается из цветков. Стоит
 * где-нибудь взять его из старой колонки — и план отдела разойдётся с суммой
 * своих частей, ровно как разошлись бы «оплачено всего» и «оплачено по
 * компаниям», если бы оба вводились руками.
 *
 * Второе: строки, записанные ДО разделения, лежат с пустым цветком. Выкинуть
 * их нельзя — у владельца пропал бы уже поставленный план; сложить с цветками
 * тоже нельзя — план задвоится. Правило одно: пока по менеджеру нет ни одной
 * строки по цветку, считается старое число; появилась хоть одна — старое
 * перестаёт участвовать и обнуляется при записи.
 *
 * Третье, менее очевидное: разрез по цветку в отчёте считается только по тем,
 * у кого план разнесён. Показать неразнесённый план розой — это враньё в
 * отчёте, поэтому он выносится отдельной цифрой «ещё не разнесено».
 *
 * Запуск: npx tsx scripts/check-manager-plans.ts
 */
import {
  PLAN_FLOWERS,
  aggregateManagerPlans,
  cleanPlanFlower,
  planByFlower,
  planCellKey,
  unsplitPlanAmount,
  type ManagerPlanInput,
} from "../src/lib/managerPlans";
import { getSalesSnapshot } from "../src/lib/salesAnalytics";
import { getLeaderboard } from "../src/lib/leaderboard";
import { FLOWER_TYPES, ORDER_STATUSES, SHEET_HEADERS, SHEET_TABS } from "../src/lib/constants";

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

// --- Колонка дописана в конец (грабли 1.1) ----------------------------------

const headers = SHEET_HEADERS[SHEET_TABS.PLANS];
check("FlowerType — последняя колонка", headers[headers.length - 1], "FlowerType");
check("прежние колонки на своих местах", headers.slice(0, 4), [
  "Period",
  "ManagerEmail",
  "TargetAmount",
  "TargetStems",
]);

// --- Чтение значения цветка -------------------------------------------------

check("известный цветок", cleanPlanFlower("rose"), "rose");
check("регистр и пробелы не мешают", cleanPlanFlower("  Rose "), "rose");
check("пусто — план без разбивки", cleanPlanFlower(""), "");
check("опечатка не становится розой (грабли 1.10)", cleanPlanFlower("roza"), "");
check("ключ ячейки нормализует почту", planCellKey("  IVAN@X.KZ ", "rose"), "ivan@x.kz|rose");

// --- Итог складывается из цветков -------------------------------------------

const period = "2026-09";
const rows: ManagerPlanInput[] = [
  { period, managerEmail: "ivan@x.kz", flowerType: "rose", targetAmount: 2_500_000, targetStems: 70_000 },
  { period, managerEmail: "ivan@x.kz", flowerType: "chrysanthemum", targetAmount: 1_500_000, targetStems: 40_000 },
  { period, managerEmail: "ivan@x.kz", flowerType: "eustoma", targetAmount: 500_000, targetStems: 10_000 },
  // Старая строка того же менеджера: разбивка есть, значит она не в счёт.
  { period, managerEmail: "ivan@x.kz", flowerType: "", targetAmount: 9_000_000, targetStems: 999_999 },
  // Менеджер со старым планом и без разбивки — считается по старому числу.
  { period, managerEmail: "aigerim@x.kz", flowerType: "", targetAmount: 3_000_000, targetStems: 80_000 },
  // Чужой месяц не должен просочиться.
  { period: "2026-08", managerEmail: "ivan@x.kz", flowerType: "rose", targetAmount: 7_000_000, targetStems: 1 },
];

const plans = aggregateManagerPlans(rows, period);

check("итог менеджера — сумма цветков", plans.get("ivan@x.kz")?.targetAmount, 4_500_000);
check("стебли тоже складываются", plans.get("ivan@x.kz")?.targetStems, 120_000);
check("старое число в счёт не идёт", plans.get("ivan@x.kz")?.splitByFlower, true);
check("но и не теряется", plans.get("ivan@x.kz")?.legacy.targetAmount, 9_000_000);
check("без разбивки считается старое число", plans.get("aigerim@x.kz")?.targetAmount, 3_000_000);
check("и помечено как неразнесённое", plans.get("aigerim@x.kz")?.splitByFlower, false);
check("чужой месяц не попал", plans.get("ivan@x.kz")?.byFlower.rose?.targetAmount, 2_500_000);

// Ноль по цветку — это тоже решение РОПа («в этом месяце не продаём»), а не
// отсутствие плана: старое число после него подхватываться не должно.
const zeroed = aggregateManagerPlans(
  [
    { period, managerEmail: "z@x.kz", flowerType: "rose", targetAmount: 0, targetStems: 0 },
    { period, managerEmail: "z@x.kz", flowerType: "", targetAmount: 5_000_000, targetStems: 1 },
  ],
  period
);
check("ноль по цветку перебивает старое число", zeroed.get("z@x.kz")?.targetAmount, 0);

// --- Разрез по цветку -------------------------------------------------------

const byFlower = planByFlower(plans.values());
check("розы", byFlower.rose.targetAmount, 2_500_000);
check("хризантемы", byFlower.chrysanthemum.targetAmount, 1_500_000);
check("эустома", byFlower.eustoma.targetAmount, 500_000);
check(
  "неразнесённый план в разрез не идёт",
  byFlower.rose.targetAmount + byFlower.chrysanthemum.targetAmount + byFlower.eustoma.targetAmount,
  4_500_000
);
check("а показывается отдельной цифрой", unsplitPlanAmount(plans.values()), 3_000_000);
check("порядок цветков", PLAN_FLOWERS, ["rose", "chrysanthemum", "eustoma"]);

// --- План-факт: разрез по цветку считается по ПОЗИЦИЯМ ----------------------

const users = [
  { email: "ivan@x.kz", name: "Иван", role: "manager", farm: null, active: true },
  { email: "aigerim@x.kz", name: "Айгерим", role: "manager", farm: null, active: true },
];

// Одна заявка, а в ней два цветка: если фильтровать заявки целиком, разрез
// развалится. Ровно на этом уже ловились регионы.
const mixedOrder = {
  orderId: "o1",
  createdAt: "2026-09-05T10:00:00",
  managerEmail: "ivan@x.kz",
  clientName: "Клиент",
  clientPhone: "",
  deliveryDate: "2026-09-06",
  status: ORDER_STATUSES.NEW,
  notes: "",
  managerConfirmed: true,
  managerConfirmedAt: "",
  paid: true,
  paidAt: "",
  paymentMethod: "",
  accountantEmail: "",
  paidAmount: 0,
  paidRoseFarm: 0,
  paidEsentai: 0,
  promisedAt: "",
  collectionNote: "",
  clientId: "c1",
  retail: "",
  direction: "",
  kind: "",
  totalAmount: 0,
  items: [
    {
      orderId: "o1",
      itemId: "i1",
      flowerType: FLOWER_TYPES.ROSE,
      variety: "Фридом",
      grade: "60",
      quantity: 1000,
      unitPrice: 250,
      shippedQuantity: 0,
    },
    {
      orderId: "o1",
      itemId: "i2",
      flowerType: FLOWER_TYPES.CHRYSANTHEMUM,
      variety: "Балтика",
      grade: "Высшая",
      quantity: 500,
      unitPrice: 300,
      shippedQuantity: 0,
    },
  ],
};

async function factChecks() {
  const snapshot = await getSalesSnapshot(period, new Date(2026, 8, 15), {
    orders: [mixedOrder as never],
    users: users as never,
    plans,
  });

  const rose = snapshot.byFlower.find((f) => f.flowerType === FLOWER_TYPES.ROSE);
  const chrys = snapshot.byFlower.find((f) => f.flowerType === FLOWER_TYPES.CHRYSANTHEMUM);
  const eustoma = snapshot.byFlower.find((f) => f.flowerType === FLOWER_TYPES.EUSTOMA);

  check("факт по розе — только её позиция", rose?.amount, 250_000);
  check("факт по хризантеме — своя", chrys?.amount, 150_000);
  check("стебли розы", rose?.stems, 1000);
  check("выполнение по розе", Math.round(rose?.progressPercent ?? -1), 10);
  check("эустома в плане есть, факта нет", eustoma?.amount, 0);
  check("выполнение по эустоме считается", Math.round(eustoma?.progressPercent ?? -1), 0);
  check(
    "сумма факта по цветкам равна продажам месяца",
    snapshot.byFlower.reduce((s, f) => s + f.amount, 0),
    snapshot.totals.amountMonth
  );
  check(
    "неразнесённый план виден отдельно",
    snapshot.unsplitTargetAmount,
    3_000_000
  );
  check(
    "общий план отдела — сумма цветков плюс неразнесённое",
    snapshot.totals.targetAmount,
    snapshot.byFlower.reduce((s, f) => s + f.targetAmount, 0) + snapshot.unsplitTargetAmount
  );

  // Рейтинг и бонусы разбивку не читают вовсе — им довольно итога. Это и есть
  // причина, по которой getPlansForPeriod по-прежнему отдаёт итог: иначе
  // пришлось бы править ещё два расчёта, и один из них отстал бы.
  const board = await getLeaderboard("month", "2026-09-15", new Date(2026, 8, 15), {
    orders: [mixedOrder as never],
    users: users as never,
    plans,
  });
  const ivan = board.rows.find((r) => r.managerEmail === "ivan@x.kz");
  check("рейтинг видит план как сумму цветков", ivan?.targetAmount, 4_500_000);
}

factChecks()
  .then(() => {
    console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
    process.exit(fails === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
