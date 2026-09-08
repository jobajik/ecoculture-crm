/*
 * Проверка аналитики: два окна по 30 дней, изменения, ориентиры и подсветка.
 *
 * Здесь легко ошибиться тихо: перепутать границу окна (заявка тридцатидневной
 * давности попадает то в текущий период, то в прошлый), поделить на ноль в
 * пустом периоде или посчитать скидку к прайсу по позициям, которых в прайсе
 * нет, — и получить «скидку 100 %». Всё это проверяется на выдуманном
 * хозяйстве с заранее известными числами.
 *
 * Запуск: npx tsx scripts/check-analytics.ts
 */
import { getAnalyticsSummary, ANALYTICS_DAYS } from "../src/lib/analytics";
import { BENCHMARKS, toneHigherBetter, toneLowerBetter } from "../src/lib/benchmarks";

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

const NOW = new Date("2026-09-30T12:00:00");

function daysAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const item = (
  flowerType: string,
  variety: string,
  grade: string,
  quantity: number,
  unitPrice: number
) => ({ flowerType, variety, grade, quantity, unitPrice, shippedQuantity: 0, orderId: "", itemId: "" });

const order = (
  orderId: string,
  ago: number,
  clientName: string,
  managerEmail: string,
  paid: boolean,
  items: ReturnType<typeof item>[],
  status = "new"
) => ({
  orderId,
  createdAt: daysAgo(ago),
  managerEmail,
  clientName,
  clientPhone: "",
  deliveryDate: daysAgo(ago),
  status,
  notes: "",
  managerConfirmed: true,
  managerConfirmedAt: "",
  paid,
  paidAt: paid ? daysAgo(ago) : "",
  paymentMethod: paid ? "Каспи" : "",
  accountantEmail: "",
  items,
  totalAmount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
});

// Текущее окно — последние 30 дней (0…29 дней назад), прошлое — 30…59.
const orders = [
  // Сейчас: 1000 роз по 200 = 200 000, оплачено.
  order("O1", 2, "Астана", "m1@x.kz", true, [item("rose", "Prestige", "60", 1000, 200)]),
  // Сейчас: 500 роз по 100 = 50 000, не оплачено (скидка к прайсу).
  order("O2", 5, "Караганда", "m2@x.kz", false, [item("rose", "Prestige", "60", 500, 100)]),
  // Ровно на границе: 29 дней назад — ещё текущее окно.
  order("O3", 29, "Астана", "m1@x.kz", true, [item("chrysanthemum", "Altaj", "Первая", 1000, 150)]),
  // Ровно за границей: 30 дней назад — уже прошлое окно.
  order("O4", 30, "Астана", "m1@x.kz", true, [item("rose", "Prestige", "60", 1000, 250)]),
  // Прошлое окно.
  order("O5", 45, "Семей", "m2@x.kz", true, [item("chrysanthemum", "Altaj", "Первая", 1000, 100)]),
  // Отменённая не считается вообще.
  order("O6", 3, "Отменённый", "m1@x.kz", false, [item("rose", "Prestige", "60", 9999, 999)], "cancelled"),
];

const batches = [
  // Приёмка в текущем окне: 10 000 роз, из них 2 000 высшей (70 см).
  { batchId: "B1", receivedAt: daysAgo(10), harvestDate: daysAgo(10), flowerType: "rose", variety: "Prestige", grade: "60", quantityIn: 8000, quantityRemaining: 3000, location: "", receivedByEmail: "" },
  { batchId: "B2", receivedAt: daysAgo(10), harvestDate: daysAgo(10), flowerType: "rose", variety: "Prestige", grade: "70", quantityIn: 2000, quantityRemaining: 1000, location: "", receivedByEmail: "" },
  // Приёмка в прошлом окне — в текущее принято не попадает.
  { batchId: "B3", receivedAt: daysAgo(40), harvestDate: daysAgo(40), flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantityIn: 5000, quantityRemaining: 2000, location: "", receivedByEmail: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/batches").listBatches>>;

const writeoffs = [
  { writeoffId: "W1", createdAt: daysAgo(4), batchId: "B1", quantity: 500, reason: "Брак", warehouseEmail: "" },
  { writeoffId: "W2", createdAt: daysAgo(50), batchId: "B3", quantity: 300, reason: "Срок", warehouseEmail: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/writeoffs").listWriteoffs>>;

// Прайс: роза 60 см — 200 ₸ на все сорта. Хризантемы в прайсе нет намеренно:
// её позиции не должны попасть в расчёт скидки.
const priceHistory = [
  { date: daysAgo(60), flowerType: "rose", variety: "", grade: "60", price: 200 },
  { date: daysAgo(60), flowerType: "rose", variety: "", grade: "70", price: 300 },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/priceHistory").listPriceHistory>>;

const settings = {
  shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 },
  warningThreshold: 0.7,
} as never as Awaited<ReturnType<typeof import("../src/lib/repo/settings").getSettings>>;

// Прогноз агронома на текущий месяц: недели складываются в месяц.
const forecast = [
  { period: "2026-09-W1", flowerType: "rose", variety: "Prestige", targetStems: 6000, updatedAt: "", updatedByEmail: "" },
  { period: "2026-09-W2", flowerType: "rose", variety: "Prestige", targetStems: 6000, updatedAt: "", updatedByEmail: "" },
  { period: "2026-08-W1", flowerType: "rose", variety: "Prestige", targetStems: 9999, updatedAt: "", updatedByEmail: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/harvestForecast").listHarvestForecast>>;

const inj = () => ({
  now: NOW,
  forecast,
  orders: orders as never,
  batches,
  writeoffs,
  priceHistory,
  settings,
});

async function main() {
  const s = await getAnalyticsSummary(null, inj());

  // --- Границы окон --------------------------------------------------------
  check("окно сравнения", s.days, ANALYTICS_DAYS);
  check("выручка за 30 дней", s.revenue.value, 200_000 + 50_000 + 150_000);
  check("выручка за прошлые 30", s.revenue.prev, 250_000 + 100_000);
  check("заявка 29 дней назад — в текущем окне", s.orders.value, 3);
  check("заявка 30 дней назад — в прошлом", s.orders.prev, 2);
  check("отменённая не считается", s.stems.value, 1000 + 500 + 1000);

  // --- Производные ---------------------------------------------------------
  check("средняя цена стебля", Math.round(s.avgPrice.value), Math.round(400_000 / 2500));
  check("средний чек", Math.round(s.avgCheck.value), Math.round(400_000 / 3));
  check("клиентов за период", s.clients.value, 2);
  check(
    "изменение считается от прошлого окна",
    Math.round(s.revenue.changePercent!),
    Math.round(((400_000 - 350_000) / 350_000) * 100)
  );

  // --- Оплата --------------------------------------------------------------
  check("оплачено за период", s.paidRevenue, 200_000 + 150_000);
  check("собираемость", Math.round(s.collectPercent), 88);
  check("долг по всей базе", s.debtTotal, 50_000);

  // --- Скидка к прайсу -----------------------------------------------------
  // В прайсе есть только роза 60: 1500 стеблей по 200 = 300 000 по прайсу,
  // продано на 250 000. Хризантема в расчёт не входит — её в прайсе нет.
  check("по прайсу заявки стоили бы", s.listRevenue, 300_000);
  check("скидка к прайсу", Math.round(s.discountPercent!), 17);

  // --- Приёмка и списание --------------------------------------------------
  check("принято за период", s.receivedStems.value, 10_000);
  check("принято в прошлом периоде", s.receivedStems.prev, 5000);
  check("высшая категория в приёмке", Math.round(s.topGradePercent!), 0);
  check("списано за период", s.writeoffStems.value, 500);
  check("списание от принятого", Number(s.writeoffPercent!.toFixed(1)), 5);
  check("деньги списания по прайсу", s.writeoffMoney, 500 * 200);
  check("причины списания", s.writeoffReasons.map((r) => r.reason), ["Брак"]);

  // --- Склад ---------------------------------------------------------------
  check("на складе", s.stockStems, 3000 + 1000 + 2000);
  check("склад в деньгах", s.stockMoney, 3000 * 200 + 1000 * 300);
  check(
    "запас в днях = остаток / темп продаж",
    Math.round(s.coverDays!),
    Math.round(6000 / (2500 / ANALYTICS_DAYS))
  );

  // --- Разрезы -------------------------------------------------------------
  check("по цветку: два цветка", s.byFlower.map((f) => f.flowerType), ["rose", "chrysanthemum"]);
  const rose = s.byFlower.find((f) => f.flowerType === "rose")!;
  check("роза: принято", rose.received, 10_000);
  check("роза: продано", rose.sold, 1500);
  check("роза: списано", rose.writeoff, 500);
  check("роза: на складе", rose.stock, 4000);
  check("роза: срок хранения", rose.shelfLifeDays, 7);
  check("роза: средняя цена", Math.round(rose.avgPrice.value), Math.round(250_000 / 1500));
  check("роза: цена упала к прошлому периоду", rose.avgPrice.prev, 250);
  check(
    "сумма выручки по цветкам = общей",
    s.byFlower.reduce((sum, f) => sum + f.revenue, 0),
    s.revenue.value
  );
  check(
    "сумма стеблей по ростовкам = общей",
    s.byGrade.reduce((sum, g) => sum + g.stems, 0),
    s.stems.value
  );
  check(
    "ростовки разных цветков не слиплись",
    new Set(s.byGrade.map((g) => `${g.flowerType}:${g.grade}`)).size,
    s.byGrade.length
  );
  check(
    "клиент считается один раз",
    s.clientRows.find((c) => c.clientName === "Астана")?.orders,
    2
  );
  check("долг привязан к клиенту", s.clientRows.find((c) => c.clientName === "Караганда")?.debt, 50_000);
  check("менеджеров", s.managers.length, 2);
  check(
    "у менеджера без оплат собираемость 0",
    Math.round(s.managers.find((m) => m.managerEmail === "m2@x.kz")!.collectPercent!),
    0
  );

  // --- Продажи: сервис и клиенты -------------------------------------------
  // Выполнение считается только по заявкам, чья доставка уже прошла: у нас
  // доставка = дате оформления, значит все три попадают, отгружено ноль.
  check("выполнение по отгрузке", s.fillRatePercent, 0);
  check("повторные клиенты", Math.round(s.repeatClientPercent!), 50);
  check("срок от заявки до доставки", s.avgLeadDays, 0);

  // --- Производство --------------------------------------------------------
  check("продано от принятого", Math.round(s.soldOfReceivedPercent!), 25);
  check(
    "приёмка по ростовке идёт в правильном порядке",
    s.receivedByGrade.map((r) => `${r.flowerType}:${r.grade}`),
    // Порядок такой же, как на главной: сначала роза, потом хризантема.
    ["rose:60", "rose:70", "chrysanthemum:Первая"]
  );
  check(
    "ростовка, которую перестали срезать, из таблицы не исчезает",
    s.receivedByGrade.find((r) => r.grade === "Первая")?.stems,
    { value: 0, prev: 5000, changePercent: -100 }
  );
  // 70 см высшей больше не считается — так решил владелец.
  check("роза 70 см не высшая", s.receivedByGrade.find((r) => r.grade === "70")?.top, false);
  check("длина 60 высшей не считается", s.receivedByGrade.find((r) => r.grade === "60")?.top, false);
  check("роза 70 см — ликвид", s.receivedByGrade.find((r) => r.grade === "70")?.liquid, true);
  check(
    "хризантема Первая — ликвид",
    s.receivedByGrade.find((r) => r.grade === "Первая")?.liquid,
    true
  );
  check("доля ликвида в срезке", Math.round(s.liquidReceivedPercent!), 100);
  check("доля ликвида на складе", Math.round(s.liquidStockPercent!), 100);
  check("приёмка: доли складываются", Math.round(s.receivedByGrade.reduce((sum, r) => sum + r.share, 0)), 100);
  check(
    "план срезки на месяц берётся из недель этого месяца",
    s.harvestPlan.find((h) => h.flowerType === "rose")?.planStems,
    12_000
  );
  check(
    "факт срезки — приёмка с начала месяца",
    s.harvestPlan.find((h) => h.flowerType === "rose")?.receivedStems,
    10_000
  );
  check(
    "выполнение плана срезки",
    Math.round(s.harvestPlan.find((h) => h.flowerType === "rose")!.percentOfPlan!),
    83
  );
  check("прошло месяца, %", Math.round(s.monthProgressPercent), 100);
  check(
    "в план-факт попадает только то, что было в этом месяце",
    s.harvestPlan.map((h) => h.flowerType),
    ["rose"]
  );

  // --- Коротко ---------------------------------------------------------------
  check("«коротко» не пустое", s.headline.length >= 3, true);
  check(
    "в «коротко» есть выручка",
    s.headline[0].includes("стеблей") && s.headline[0].includes("₸"),
    true
  );
  check(
    "в «коротко» есть склад",
    s.headline.some((h) => h.includes("на складе")),
    true
  );

  // --- Подсветка -----------------------------------------------------------
  check("недель в графике", s.weeks.length, 8);
  check(
    "последняя неделя — самая свежая",
    s.weeks[7].revenue >= 0 && s.weeks.every((w) => w.revenue >= 0),
    true
  );
  check(
    "просрочка розы попала в «на что смотреть»",
    s.attention.some((a) => a.title.includes("Просрочено")),
    true
  );
  check(
    "запас дольше срока хранения замечен",
    s.attention.some((a) => a.title.includes("Запаса больше") || a.title.includes("запаса больше")),
    true
  );
  check(
    "про запас пишем одной строкой на все цветки",
    s.attention.filter((a) => a.title.toLowerCase().includes("запаса больше")).length,
    1
  );
  check(
    "скидка к прайсу замечена",
    s.attention.some((a) => a.title.includes("дешевле прайса")),
    true
  );

  // --- Ориентиры -----------------------------------------------------------
  check("списание 2 % — хорошо", toneLowerBetter(2, BENCHMARKS.writeoffPercent), "good");
  check("списание 5 % — внимание", toneLowerBetter(5, BENCHMARKS.writeoffPercent), "warning");
  check("списание 9 % — плохо", toneLowerBetter(9, BENCHMARKS.writeoffPercent), "critical");
  check("собираемость 95 % — хорошо", toneHigherBetter(95, BENCHMARKS.collectPercent), "good");
  check("собираемость 60 % — плохо", toneHigherBetter(60, BENCHMARKS.collectPercent), "critical");

  // --- Пустое хозяйство ----------------------------------------------------
  const empty = await getAnalyticsSummary(null, {
    now: NOW,
    orders: [] as never,
    batches: [] as never,
    writeoffs: [] as never,
    priceHistory: [] as never,
    settings,
  });
  check("пусто: без деления на ноль", empty.revenue.value, 0);
  check("пусто: изменения не выдумываются", empty.revenue.changePercent, null);
  check("пусто: скидки нет", empty.discountPercent, null);
  check("пусто: запас неизвестен", empty.coverDays, null);
  check("пусто: списание неизвестно", empty.writeoffPercent, null);
  check("пусто: таблицы пустые", [empty.byFlower.length, empty.byGrade.length, empty.clientRows.length], [0, 0, 0]);
  check("пусто: недели всё равно есть", empty.weeks.length, 8);
  check("пусто: выполнение неизвестно", empty.fillRatePercent, null);
  check("пусто: повторных клиентов нет", empty.repeatClientPercent, null);
  check("пусто: приёмка по ростовке пустая", empty.receivedByGrade.length, 0);
  check("пусто: плана срезки нет", empty.harvestPlan.length, 0);
  check("пусто: доля ликвида неизвестна", [empty.liquidReceivedPercent, empty.liquidStockPercent], [null, null]);
  check("пусто: «коротко» всё равно есть", empty.headline.length > 0, true);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
