/*
 * Проверка календаря месяца.
 *
 * Тихие ошибки здесь такие: заявка соседнего месяца попадает в сетку; деньги
 * встают в день оформления вместо дня оплаты; сумма дней не сходится с итогом
 * месяца; месяц, начавшийся в воскресенье, съезжает на неделю. Всё это не
 * падает — просто показывает неправду, по которой потом делают выводы.
 *
 * Запуск: npx tsx scripts/check-calendar.ts
 */
import { buildCalendarMonth } from "../src/lib/calendar";
import type { PriceRow } from "../src/lib/priceList";
import { currentPrices } from "../src/lib/priceList";

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
const MONTH = "2026-09";

function order(
  orderId: string,
  createdAt: string,
  clientName: string,
  managerEmail: string,
  qty: number,
  price: number,
  paid: { at: string; amount: number } | null,
  status = "new"
) {
  return {
    orderId,
    createdAt,
    managerEmail,
    clientName,
    clientPhone: "",
    deliveryDate: createdAt,
    status,
    notes: "",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: paid ? paid.amount >= qty * price : false,
    paidAt: paid?.at ?? "",
    paymentMethod: paid ? "Каспи" : "",
    accountantEmail: "",
    paidAmount: paid?.amount ?? 0,
    promisedAt: "",
    collectionNote: "",
    totalAmount: qty * price,
    items: [
      {
        orderId,
        itemId: `${orderId}-I1`,
        flowerType: "rose",
        variety: "Prestige",
        grade: "60",
        quantity: qty,
        unitPrice: price,
        shippedQuantity: 0,
      },
    ],
  };
}

const orders = [
  // 3 сентября: две заявки разных менеджеров, деньги по одной пришли 7-го.
  order("O1", "2026-09-03", "Астана", "m1@x.kz", 1000, 200, { at: "2026-09-07", amount: 200_000 }),
  order("O2", "2026-09-03", "Караганда", "m2@x.kz", 500, 180, null),
  // 30 августа — соседний месяц, в сетку попадать не должна.
  order("O3", "2026-08-30", "Чужой месяц", "m1@x.kz", 900, 100, { at: "2026-08-31", amount: 90_000 }),
  // Отменённая не считается вообще.
  order("O4", "2026-09-04", "Отменённая", "m1@x.kz", 9999, 999, null, "cancelled"),
  // Частичная оплата 5-го числа.
  order("O5", "2026-09-05", "Шымкент", "m2@x.kz", 1000, 300, { at: "2026-09-05", amount: 120_000 }),
];

const batches = [
  { batchId: "B1", receivedAt: "2026-09-02", harvestDate: "2026-09-01", flowerType: "rose", variety: "Prestige", grade: "60", quantityIn: 5000, quantityRemaining: 5000, location: "", receivedByEmail: "" },
  { batchId: "B2", receivedAt: "2026-09-02", harvestDate: "2026-09-01", flowerType: "rose", variety: "Prestige", grade: "40", quantityIn: 3000, quantityRemaining: 3000, location: "", receivedByEmail: "" },
  { batchId: "B3", receivedAt: "2026-09-02", harvestDate: "2026-09-01", flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantityIn: 2000, quantityRemaining: 2000, location: "", receivedByEmail: "" },
  // Приёмка соседнего месяца.
  { batchId: "B4", receivedAt: "2026-08-28", harvestDate: "2026-08-28", flowerType: "rose", variety: "Prestige", grade: "60", quantityIn: 7000, quantityRemaining: 0, location: "", receivedByEmail: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/batches").listBatches>>;

const shipments = [
  { shipmentId: "S1", createdAt: "2026-09-04", orderId: "O1", itemId: "O1-I1", batchId: "B1", quantity: 600, warehouseEmail: "w@x.kz", notes: "" },
  { shipmentId: "S2", createdAt: "2026-09-04", orderId: "O1", itemId: "O1-I1", batchId: "B3", quantity: 400, warehouseEmail: "w@x.kz", notes: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/shipments").listShipments>>;

const writeoffs = [
  { writeoffId: "W1", createdAt: "2026-09-06", batchId: "B1", quantity: 150, reason: "Брак", warehouseEmail: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/writeoffs").listWriteoffs>>;

const priceRows: PriceRow[] = [
  { date: "2026-09-01", flowerType: "rose", variety: "", grade: "60", price: 200 },
  { date: "2026-09-01", flowerType: "rose", variety: "", grade: "40", price: 120 },
];

const data = buildCalendarMonth({
  month: MONTH,
  now: NOW,
  orders: orders as never,
  batches,
  shipments,
  writeoffs,
  prices: currentPrices(priceRows, "2026-09-10"),
  nameByEmail: new Map([
    ["m1@x.kz", "Айгерим"],
    ["m2@x.kz", "Ержан"],
  ]),
});

const byDate = new Map(data.days.map((d) => [d.date, d]));
const d = (key: string) => byDate.get(key)!;

// --- Сетка -------------------------------------------------------------------
check("дней в сентябре", data.days.length, 30);
// 1 сентября 2026 — вторник, значит перед ним одна пустая клетка.
check("месяц начинается со вторника", data.leadingBlanks, 1);
check("первый день — вторник", data.days[0].weekday, 2);
check("последний день — среда", data.days[29].weekday, 3);
check("сегодня отмечено ровно один раз", data.days.filter((x) => x.isToday).length, 1);
check("будущие дни помечены", [d("2026-09-10").future, d("2026-09-11").future], [false, true]);

// Месяц, начинающийся с воскресенья, — самый опасный случай для сдвига.
const nov = buildCalendarMonth({
  month: "2026-11",
  now: NOW,
  orders: [],
  batches: [] as never,
  shipments: [] as never,
  writeoffs: [] as never,
  prices: new Map(),
  nameByEmail: new Map(),
});
check("1 ноября 2026 — воскресенье, шесть пустых клеток", nov.leadingBlanks, 6);
check("ноябрь: 30 дней", nov.days.length, 30);

// --- Продажи -----------------------------------------------------------------
check("продажи 3 сентября", d("2026-09-03").soldMoney, 200_000 + 90_000);
check("заявок 3 сентября", d("2026-09-03").orderCount, 2);
check("чужой месяц не попал", data.totals.soldMoney, 200_000 + 90_000 + 300_000);
check("отменённая не считается", d("2026-09-04").orderCount, 0);
check(
  "кто продал 3 сентября",
  d("2026-09-03").byManager.map((m) => [m.label, m.amount]),
  [
    ["Айгерим", 200_000],
    ["Ержан", 90_000],
  ]
);
check("заявки дня отсортированы по сумме", d("2026-09-03").orders[0].clientName, "Астана");

// --- Деньги ------------------------------------------------------------------
// Заявка O1 оформлена 3-го, оплачена 7-го: деньги должны стоять в седьмом.
check("деньги стоят в дне оплаты", d("2026-09-07").paidMoney, 200_000);
check("в дне оформления денег нет", d("2026-09-03").paidMoney, 0);
check("частичная оплата видна в свой день", d("2026-09-05").paidMoney, 120_000);
check("оплаты месяца", data.totals.paidMoney, 200_000 + 120_000);
check("оплата подписана клиентом", d("2026-09-07").payments[0].clientName, "Астана");

// --- Срез --------------------------------------------------------------------
check("срез 2 сентября", d("2026-09-02").receivedStems, 10_000);
check("срез в деньгах по прайсу", d("2026-09-02").receivedMoney, 5000 * 200 + 3000 * 120);
check(
  "срез по цветку",
  d("2026-09-02").receivedByFlower.map((f) => [f.label, f.stems]),
  [
    ["Роза", 8000],
    ["Хризантема", 2000],
  ]
);
check(
  "ростовка в естественном порядке, а не по количеству",
  d("2026-09-02").receivedByGrade.map((g) => g.label),
  ["Роза 40 см", "Роза 60 см", "Хризантема Высшая"]
);
check("срез соседнего месяца не попал", data.totals.receivedStems, 10_000);

// --- Отгрузки и списания -----------------------------------------------------
check("отгружено 4 сентября", d("2026-09-04").shippedStems, 1000);
check("отгрузок 4 сентября", d("2026-09-04").shipmentCount, 2);
check(
  "отгрузка разложена по цветку через партию",
  d("2026-09-04").shippedByFlower.map((f) => [f.label, f.stems]),
  [
    ["Роза", 600],
    ["Хризантема", 400],
  ]
);
check("списание 6 сентября", d("2026-09-06").writeoffs, [{ reason: "Брак", stems: 150 }]);

// --- Итоги сходятся с днями --------------------------------------------------
const sum = (pick: (x: (typeof data.days)[number]) => number) =>
  data.days.reduce((s, x) => s + pick(x), 0);
check("итог продаж = сумме дней", data.totals.soldMoney, sum((x) => x.soldMoney));
check("итог среза = сумме дней", data.totals.receivedStems, sum((x) => x.receivedStems));
check("итог отгрузок = сумме дней", data.totals.shippedStems, sum((x) => x.shippedStems));
check("итог оплат = сумме дней", data.totals.paidMoney, sum((x) => x.paidMoney));
check("прошедших дней", data.totals.daysPassed, 10);
check("рабочих дней (были заявки)", data.totals.workingDays, 2);
// Максимум по дням — 5 сентября: 1000 × 300.
check("максимум для подсветки", data.max.sold, 300_000);
check("«коротко» не пустое", data.headline.length > 0, true);

// --- Пустой месяц ------------------------------------------------------------
const empty = buildCalendarMonth({
  month: "2026-12",
  now: NOW,
  orders: [],
  batches: [] as never,
  shipments: [] as never,
  writeoffs: [] as never,
  prices: new Map(),
  nameByEmail: new Map(),
});
check("пустой месяц не делит на ноль", empty.totals.soldMoney, 0);
check("пустой месяц: подсветка нулевая", empty.max.sold, 0);
check("пустой месяц: все дни будущие", empty.days.every((x) => x.future), true);
check("пустой месяц: фраза всё равно есть", empty.headline.length > 0, true);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
