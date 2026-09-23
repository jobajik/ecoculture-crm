/**
 * «Планы → Обзор» и «Срезка»: цифры, по которым РОП решает, кого торопить.
 *
 * Проверяем расчёт, а не вёрстку: темп месяца (прошлый, текущий, будущий),
 * «должно было уйти к сегодня» по неделям, кто отстаёт, что везут без плана,
 * где не хватит срезки и что не заполнено. Отдельно — плитка недели на вкладке
 * «Срезка»: «сходится» с допуском, а без прогноза — не «не хватит».
 */
import { buildPlanOverview, expectedToDate, paceOf } from "../src/lib/planOverview";
import { weekState } from "../src/components/HarvestWeeks";
import { FLOWER_TYPES, weeksOfMonth } from "../src/lib/constants";
import { paceTone } from "../src/components/PlanProgress";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const MONTH = "2026-09";
const TODAY = "2026-09-15";
const weeks = weeksOfMonth(MONTH);

// --- Темп ------------------------------------------------------------------
check("темп: середина сентября", Math.round(paceOf(MONTH, TODAY).pacePercent), 50);
check("темп: прошлый месяц — 100 %", paceOf("2026-08", TODAY).pacePercent, 100);
check("темп: будущий месяц — 0", paceOf("2026-10", TODAY).pacePercent, 0);
check("темп: дней в сентябре", paceOf(MONTH, TODAY).daysInMonth, 30);

// --- Цвет полоски ------------------------------------------------------------
check("полоска: идём в темпе — зелёная", paceTone(48, 50), "good");
check("полоска: чуть отстаём — жёлтая", paceTone(40, 50), "warn");
check("полоска: сильно отстаём — красная", paceTone(20, 50), "critical");
check("полоска: плана нет — серая", paceTone(null, 50), "none");
check("полоска: будущий месяц не красный", paceTone(0, 0), "good");

// --- Должно было уйти к сегодня ------------------------------------------------
// Сентябрь 2026: W1 1–6, W2 7–13, W3 14–20 (сегодня 15-е — второй день из семи).
const plan: Record<string, number> = {};
for (const w of weeks) plan[w.code] = 700;
check(
  "к сегодня: две прошедшие недели целиком + 2/7 текущей",
  expectedToDate(weeks, plan, TODAY),
  700 + 700 + 200
);
check("к сегодня: до начала месяца — ноль", expectedToDate(weeks, plan, "2026-08-31"), 0);
check("к сегодня: после месяца — весь план", expectedToDate(weeks, plan, "2026-10-02"), 700 * weeks.length);

// --- Сборка обзора -------------------------------------------------------------
const W1 = weeks[0].code;
const W2 = weeks[1].code;
const R = FLOWER_TYPES.ROSE;
const C = FLOWER_TYPES.CHRYSANTHEMUM;

const sales = {
  totals: {
    amountMonth: 3_000_000, stemsMonth: 0, ordersMonth: 0, amountToday: 0, ordersToday: 0,
    targetAmount: 6_000_000, targetStems: 0, progressPercent: 50, forecastAmount: 6_000_000,
    daysPassed: 15, daysInMonth: 30, requiredPerDay: 200_000,
  },
  managers: [
    { managerEmail: "a@x", name: "Айгуль", amountMonth: 2_500_000, targetAmount: 3_000_000 },
    { managerEmail: "b@x", name: "Бекзат", amountMonth: 500_000, targetAmount: 3_000_000 },
    { managerEmail: "c@x", name: "Вера", amountMonth: 100_000, targetAmount: 0 },
  ].map((m) => ({
    ...m, stemsMonth: 0, ordersMonth: 0, amountToday: 0, ordersToday: 0, targetStems: 0,
    progressPercent: 0, avgOrderAmount: 0, byFarm: {}, byFlower: {},
  })),
  byFlower: [
    { flowerType: R, amount: 2_000_000, stems: 0, targetAmount: 4_000_000, targetStems: 0, progressPercent: 50 },
    { flowerType: C, amount: 1_000_000, stems: 0, targetAmount: 0, targetStems: 0, progressPercent: null },
  ],
  unsplitTargetAmount: 0,
};

const orders = [
  {
    orderId: "1", clientName: "К1", deliveryDate: "2026-09-03", status: "new", direction: "Астана",
    managerEmail: "a@x", items: [{ flowerType: R, quantity: 900, shippedQuantity: 900, unitPrice: 300 }],
  },
  {
    orderId: "2", clientName: "К2", deliveryDate: "2026-09-10", status: "new", direction: "Киргизия",
    managerEmail: "a@x", items: [{ flowerType: R, quantity: 300, shippedQuantity: 0, unitPrice: 300 }],
  },
  {
    orderId: "3", clientName: "К3", deliveryDate: "2026-09-10", status: "cancelled", direction: "Астана",
    managerEmail: "a@x", items: [{ flowerType: R, quantity: 5000, shippedQuantity: 0, unitPrice: 300 }],
  },
];

const shipmentPlans = [
  { period: W1, direction: "Астана", flowerType: R, targetStems: 1000, targetAmount: 0 },
  { period: W2, direction: "Астана", flowerType: R, targetStems: 1000, targetAmount: 0 },
  { period: W1, direction: "Караганда", flowerType: C, targetStems: 2000, targetAmount: 0 },
  // Чужой месяц — не должен попасть никуда.
  { period: "2026-10-W1", direction: "Астана", flowerType: R, targetStems: 99_999, targetAmount: 0 },
];

const forecast = {
  [R]: { [W1]: 1500, [W2]: 800 },
  [C]: { [W1]: 1000 },
};

const o = buildPlanOverview({
  month: MONTH, today: TODAY, weeks, sales, orders, shipmentPlans, forecast,
  activeManagers: 3, managersWithPlan: 2, cancelledStatus: "cancelled",
});

check("продажи: выполнение", o.sales.percent, 50);
check("продажи: отстаёт только Бекзат (17 % при темпе 50 %)", o.sales.behind.map((b) => b.name), ["Бекзат"]);
check("продажи: продаёт без плана", o.sales.noPlan, ["Вера"]);
check("продажи: у хризантемы плана нет — процент пустой", o.sales.byFlower.find((f) => f.flowerType === C)?.percent, null);

check("отгрузки: план месяца без чужого месяца", o.shipments.planStems, 4000);
check("отгрузки: заказано без отменённой", o.shipments.orderedStems, 1200);
check("отгрузки: отгружено", o.shipments.shippedStems, 900);
check("отгрузки: Киргизия — без плана", o.shipments.unplanned, [{ direction: "Киргизия", ordered: 300 }]);
check(
  "отгрузки: Караганда отстаёт (0 из 2000)",
  o.shipments.behind.map((b) => b.direction),
  ["Караганда"]
);

const rose = o.harvest.byFlower.find((f) => f.flowerType === R)!;
check("срезка: роза за месяц", [rose.forecast, rose.planned, rose.diff], [2300, 2000, 300]);
check(
  "срезка: не хватит — хризантема неделя 1 и роза неделя 2",
  o.harvest.shortWeeks.map((s) => [s.flowerType, s.missing]),
  [[R, 200], [C, 1000]]
);

check("список: план продаж не у всех", o.checklist.find((c) => c.key === "sales")?.done, false);
check("список: прогноз по эустоме не загружен", o.checklist.find((c) => c.key === "forecast")?.detail, "нет: эустома");

// Пустой месяц: без прогноза нехватки нет — это не новость о срезке.
const empty = buildPlanOverview({
  month: MONTH, today: TODAY, weeks, sales: { ...sales, managers: [], byFlower: [] },
  orders: [], shipmentPlans, forecast: {}, activeManagers: 0, managersWithPlan: 0, cancelledStatus: "cancelled",
});
check("пусто: без прогноза «не хватит» не пишем", empty.harvest.shortWeeks.length, 0);
check("пусто: прогноза нет", empty.harvest.hasForecast, false);
check("пусто: нет менеджеров — пункт не выполнен", empty.checklist[0].detail, "активных менеджеров нет");

// --- Плитка недели на «Срезке» ------------------------------------------------
check("неделя: пусто", weekState(0, 0), "empty");
check("неделя: плана нет", weekState(1000, 0), "noPlan");
check("неделя: прогноза нет — не «не хватит»", weekState(0, 500), "noForecast");
check("неделя: разница 2 % — сходится", weekState(1000, 980), "match");
check("неделя: остаток", weekState(1000, 800), "surplus");
check("неделя: не хватит", weekState(1000, 1200), "short");

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
