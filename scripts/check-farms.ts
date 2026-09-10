/* Проверка разделения по производствам: ручной расчёт против того, что считает код. */
import { getPicklist } from "../src/lib/picklist";
import { getSalesSnapshot } from "../src/lib/salesAnalytics";
import { getStockSnapshot } from "../src/lib/stock";
import { getDailySalesSnapshot } from "../src/lib/dailySales";

const NOW = new Date("2026-09-06T12:00:00");
const TODAY = "2026-09-06";

const users = [
  { email: "m1@x.kz", name: "Айгерим С.", role: "manager", farm: null, active: true },
  { email: "m2@x.kz", name: "Ержан Т.", role: "manager", farm: null, active: true },
  { email: "w1@x.kz", name: "Склад Розы", role: "warehouse", farm: "rose_farm", active: true },
  { email: "w2@x.kz", name: "Склад Хриз", role: "warehouse", farm: "esentai", active: true },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/users").listUsers>>;

const orders = [
  {
    orderId: "O1",
    clientName: "Клиент А",
    clientPhone: "",
    managerEmail: "m1@x.kz",
    status: "new",
    notes: "",
    deliveryDate: TODAY,
    createdAt: `${TODAY}T09:00:00`,
    items: [
      // Rose Farm: 100 × 500 = 50 000
      { flowerType: "rose", variety: "Prestige", grade: "60", quantity: 100, unitPrice: 500, shipped: 0 },
      // Есентай: 50 × 300 = 15 000
      { flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantity: 50, unitPrice: 300, shipped: 0 },
    ],
  },
  {
    orderId: "O2",
    clientName: "Клиент Б",
    clientPhone: "",
    managerEmail: "m2@x.kz",
    status: "new",
    notes: "",
    deliveryDate: TODAY,
    createdAt: `${TODAY}T10:00:00`,
    items: [
      // Rose Farm: 20 × 700 = 14 000
      { flowerType: "eustoma", variety: "Alissa White", grade: "Стандарт", quantity: 20, unitPrice: 700, shipped: 0 },
    ],
  },
  {
    orderId: "O3",
    clientName: "Только хризантема",
    clientPhone: "",
    managerEmail: "m2@x.kz",
    status: "new",
    notes: "",
    deliveryDate: TODAY,
    createdAt: `${TODAY}T11:00:00`,
    items: [
      // Есентай: 200 × 250 = 50 000
      { flowerType: "chrysanthemum", variety: "Ассортимент", grade: "Первая", quantity: 200, unitPrice: 250, shipped: 0 },
    ],
  },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/orders").listOrdersWithItems>>;

const batches = [
  { batchId: "B1", harvestDate: "2026-09-04", flowerType: "rose", variety: "Prestige", grade: "60", quantityIn: 300, quantityRemaining: 300, location: "", receivedByEmail: "w1@x.kz", receivedAt: "2026-09-04T08:00:00" },
  { batchId: "B2", harvestDate: "2026-09-05", flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantityIn: 400, quantityRemaining: 400, location: "", receivedByEmail: "w2@x.kz", receivedAt: "2026-09-05T08:00:00" },
  { batchId: "B3", harvestDate: "2026-09-05", flowerType: "eustoma", variety: "Alissa White", grade: "Стандарт", quantityIn: 60, quantityRemaining: 60, location: "", receivedByEmail: "w1@x.kz", receivedAt: "2026-09-05T08:00:00" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/batches").listBatches>>;

const plans = new Map([
  ["m1@x.kz", { targetAmount: 100_000, targetStems: 1000 }],
  ["m2@x.kz", { targetAmount: 100_000, targetStems: 1000 }],
]);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ожидалось ${JSON.stringify(expected)})`}`);
}

async function main() {
  // --- Сводная заявка Rose Farm: только розы + эустома, O3 выпадает целиком ---
  const roseList = await getPicklist(TODAY, NOW, { orders, batches, users }, "rose_farm");
  check("picklist rose_farm: заявок", roseList.totalOrders, 2);
  check("picklist rose_farm: стеблей", roseList.totalStems, 120);
  check("picklist rose_farm: типы", [...new Set(roseList.lines.map((l) => l.flowerType))].sort(), ["eustoma", "rose"]);
  check("picklist rose_farm: клиенты", roseList.orders.map((o) => o.clientName).sort(), ["Клиент А", "Клиент Б"]);

  const esentaiList = await getPicklist(TODAY, NOW, { orders, batches, users }, "esentai");
  check("picklist esentai: заявок", esentaiList.totalOrders, 2);
  check("picklist esentai: стеблей", esentaiList.totalStems, 250);
  check("picklist esentai: типы", [...new Set(esentaiList.lines.map((l) => l.flowerType))], ["chrysanthemum"]);

  const allList = await getPicklist(TODAY, NOW, { orders, batches, users }, null);
  check("picklist без фильтра: стеблей = сумма двух", allList.totalStems, 120 + 250);
  check("picklist без фильтра: заявок", allList.totalOrders, 3);

  // Пустой день не должен быть тупиком: подсказка обязана показать ближайшие
  // даты, где заявки есть, — и только по своему производству.
  const emptyDay = await getPicklist("2000-01-01", NOW, { orders, batches, users }, "rose_farm");
  check("пустой день: заявок нет", emptyDay.totalOrders, 0);
  check(
    "пустой день: подсказка ведёт на день с заявками",
    emptyDay.nearbyDates.map((d) => d.date),
    [TODAY]
  );
  check(
    "подсказка считает стебли своего производства",
    emptyDay.nearbyDates[0]?.stems,
    120
  );
  const emptyEsentai = await getPicklist("2000-01-01", NOW, { orders, batches, users }, "esentai");
  check("подсказка у другого склада — свои стебли", emptyEsentai.nearbyDates[0]?.stems, 250);
  check(
    "на выбранный день подсказка не показывает сам этот день",
    (await getPicklist(TODAY, NOW, { orders, batches, users }, "rose_farm")).nearbyDates.length,
    0
  );

  // --- Остатки ---
  const settings = { shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 }, warningThreshold: 0.7 } as never as Awaited<
    ReturnType<typeof import("../src/lib/repo/settings").getSettings>
  >;
  const roseStock = await getStockSnapshot(NOW, { batches, settings }, "rose_farm");
  check("остатки rose_farm: типы", roseStock.byFlowerType.map((t) => t.flowerType).sort(), ["eustoma", "rose"]);
  check("остатки rose_farm: стеблей", roseStock.totalStems, 360);
  const esentaiStock = await getStockSnapshot(NOW, { batches, settings }, "esentai");
  check("остатки esentai: стеблей", esentaiStock.totalStems, 400);
  const allStock = await getStockSnapshot(NOW, { batches, settings }, null);
  check("остатки без фильтра: по производствам", allStock.byFarm.map((f) => [f.farm, f.quantity]).sort(), [["esentai", 400], ["rose_farm", 360]]);

  // --- Продажи за месяц по производствам ---
  const sales = await getSalesSnapshot("2026-09", NOW, { orders, users, plans });
  const rose = sales.byFarm.find((f) => f.farm === "rose_farm");
  const esentai = sales.byFarm.find((f) => f.farm === "esentai");
  check("продажи Rose Farm, ₸", rose?.amount, 50_000 + 14_000);
  check("продажи Есентай, ₸", esentai?.amount, 15_000 + 50_000);
  check("продажи Rose Farm, шт", rose?.stems, 120);
  check("продажи Есентай, шт", esentai?.stems, 250);
  check("сумма по производствам = итог месяца", (rose?.amount ?? 0) + (esentai?.amount ?? 0), sales.totals.amountMonth);
  const m1 = sales.managers.find((m) => m.managerEmail === "m1@x.kz");
  check("менеджер m1 по производствам", m1?.byFarm, { rose_farm: 50_000, esentai: 15_000 });

  // --- Дневной дашборд ---
  const daily = await getDailySalesSnapshot(TODAY, NOW, { orders, users });
  check("день: доли по производствам = 100%", Math.round(daily.byFarm.reduce((s, f) => s + f.share, 0)), 100);
  check("день: Rose Farm ₸", daily.byFarm.find((f) => f.farm === "rose_farm")?.amount, 64_000);

  console.log(failures === 0 ? "\nВсе проверки прошли." : `\nПровалено проверок: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
