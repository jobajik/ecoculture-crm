/* Изоляция производств: зав. складом не должен видеть чужой цветок нигде. */
import { getAnalyticsSummary } from "../src/lib/analytics";
import { getFarmFor, flowerTypesForFarm } from "../src/lib/constants";

// Заявка со смешанным составом — самый опасный случай: её видят оба склада,
// но каждый должен видеть только свои позиции и свою сумму.
const orders = [
  {
    orderId: "MIX",
    clientName: "Смешанный",
    clientPhone: "",
    managerEmail: "m1@x.kz",
    status: "new",
    notes: "",
    deliveryDate: "2026-09-08",
    createdAt: "2026-09-08T09:00:00",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: true,
    paidAmount: 80_000, // оплачена целиком одной суммой на оба производства
    promisedAt: "",
    collectionNote: "",
    paidAt: "",
    paymentMethod: "Каспи",
    accountantEmail: "",
    totalAmount: 80_000,
    items: [
      { flowerType: "rose", variety: "Prestige", grade: "60", quantity: 100, unitPrice: 500, shippedQuantity: 0 },
      { flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantity: 100, unitPrice: 300, shippedQuantity: 0 },
    ],
  },
  {
    orderId: "ROSE_ONLY",
    clientName: "Только розы",
    clientPhone: "",
    managerEmail: "m1@x.kz",
    status: "new",
    notes: "",
    deliveryDate: "2026-09-08",
    createdAt: "2026-09-08T10:00:00",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: false,
    paidAmount: 0,
    promisedAt: "",
    collectionNote: "",
    paidAt: "",
    paymentMethod: "",
    accountantEmail: "",
    totalAmount: 40_000,
    items: [
      { flowerType: "rose", variety: "Freedom", grade: "60", quantity: 100, unitPrice: 400, shippedQuantity: 0 },
    ],
  },
];

/**
 * Повторяем ровно ту логику, что стоит на страницах «Заявки» и «Заявка»:
 * вырезаем чужие позиции и убираем заявки, где своего цветка не осталось.
 */
function visibleOrders(farm: string | null) {
  if (!farm) return orders;
  return orders
    .map((o) => {
      const items = o.items.filter((i) => getFarmFor(i.flowerType) === farm);
      return { ...o, items, totalAmount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) };
    })
    .filter((o) => o.items.length > 0);
}

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

async function main() {
  // --- Список заявок ---
  const esentai = visibleOrders("esentai");
  check("Есентай: видит только одну заявку", esentai.map((o) => o.orderId), ["MIX"]);
  check("Есентай: чисто розовая заявка скрыта", esentai.some((o) => o.orderId === "ROSE_ONLY"), false);
  check("Есентай: в смешанной только хризантема", esentai[0].items.map((i) => i.flowerType), ["chrysanthemum"]);
  check("Есентай: сумма пересчитана без роз", esentai[0].totalAmount, 30_000);

  const roseFarm = visibleOrders("rose_farm");
  check("Rose Farm: видит обе заявки", roseFarm.map((o) => o.orderId), ["MIX", "ROSE_ONLY"]);
  check("Rose Farm: в смешанной только роза", roseFarm[0].items.map((i) => i.flowerType), ["rose"]);
  check("Rose Farm: сумма без хризантемы", roseFarm[0].totalAmount, 50_000);

  const admin = visibleOrders(null);
  check("Админ: видит всё целиком", admin[0].items.length, 2);
  check("Админ: полная сумма", admin[0].totalAmount, 80_000);

  // Сходимость: части двух складов дают целое
  check(
    "части складов = целое",
    esentai[0].totalAmount + roseFarm[0].totalAmount,
    admin[0].totalAmount
  );

  // --- Аналитика ---
  const batches = [
    { batchId: "B1", receivedAt: "", harvestDate: "2026-09-06", flowerType: "rose", variety: "Prestige", grade: "60", quantityIn: 300, quantityRemaining: 300, location: "", receivedByEmail: "" },
    { batchId: "B2", receivedAt: "", harvestDate: "2026-09-06", flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantityIn: 400, quantityRemaining: 400, location: "", receivedByEmail: "" },
  ];

  const settings = {
    shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 },
    warningThreshold: 0.7,
  } as never;
  const priceHistory = [
    { date: "2026-09-08", flowerType: "rose", variety: "Prestige", grade: "60", price: 500 },
    { date: "2026-09-08", flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", price: 300 },
  ] as never;
  const inj = () => ({
    // «Сегодня» фиксируем: аналитика считает два окна по 30 дней от текущей
    // даты, и без этого проверка ломалась бы через месяц сама по себе.
    now: new Date("2026-09-08T12:00:00"),
    orders: orders as never,
    batches: batches as never,
    writeoffs: [] as never,
    priceHistory,
    settings,
  });

  const aEsentai = await getAnalyticsSummary("esentai", inj());
  check(
    "аналитика Есентая: в разрезе по цветку только хризантема",
    aEsentai.byFlower.map((f) => f.flowerType),
    ["chrysanthemum"]
  );
  check(
    "аналитика Есентая: в ростовках только хризантема",
    [...new Set(aEsentai.byGrade.map((g) => g.flowerType))],
    ["chrysanthemum"]
  );
  check("аналитика Есентая: на складе только своё", aEsentai.stockStems, 400);
  check("аналитика Есентая: выручка только своя", aEsentai.revenue.value, 30_000);
  check("аналитика Есентая: склад в деньгах по своему прайсу", aEsentai.stockMoney, 400 * 300);

  const aRose = await getAnalyticsSummary("rose_farm", inj());
  check(
    "аналитика Rose Farm: в разрезе по цветку только роза",
    aRose.byFlower.map((f) => f.flowerType),
    ["rose"]
  );
  check("аналитика Rose Farm: выручка своя", aRose.revenue.value, 90_000);
  check("аналитика Rose Farm: чужой клиент не потерялся", aRose.clientRows.length, 2);

  const aAll = await getAnalyticsSummary(null, inj());
  check(
    "аналитика админа: оба типа",
    aAll.byFlower.map((f) => f.flowerType).sort(),
    ["chrysanthemum", "rose"]
  );
  check("аналитика: части = целое", aEsentai.revenue.value + aRose.revenue.value, aAll.revenue.value);
  check("аналитика: стебли тоже сходятся", aEsentai.stems.value + aRose.stems.value, aAll.stems.value);
  check(
    "аналитика: долг считается по неоплаченным",
    aAll.debtTotal,
    40_000
  );
  check("аналитика: собираемость", Math.round(aAll.collectPercent), 67);

  // --- Колонки на главной: чужой цветок не должен даже присутствовать ---
  const COLUMN_ORDER = ["rose", "chrysanthemum", "eustoma"];
  const columnsFor = (farm: string | null) => {
    const allowed = flowerTypesForFarm(farm);
    return COLUMN_ORDER.filter((t) => allowed.includes(t));
  };
  check("главная у Дианы (esentai): колонки", columnsFor("esentai"), ["chrysanthemum"]);
  check("главная у Разии (rose_farm): колонки", columnsFor("rose_farm"), ["rose", "eustoma"]);
  check("главная у админа: все три", columnsFor(null), ["rose", "chrysanthemum", "eustoma"]);
  check(
    "у Дианы нет ни розы, ни эустомы",
    columnsFor("esentai").some((t) => t === "rose" || t === "eustoma"),
    false
  );

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
