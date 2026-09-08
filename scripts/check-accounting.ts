/*
 * Проверка того, что бухгалтер делает с деньгами: частичная оплата, долги,
 * список звонков и пересчёт заявки по рекламации.
 *
 * Здесь легче всего ошибиться тихо и дорого: посчитать долгом всю сумму
 * заявки, по которой уже пришла предоплата; оставить галочку «оплачено» от
 * старой суммы после пересчёта; или показать переплату как оплату. Такие
 * ошибки не падают — они просто дают неверные цифры, по которым звонят
 * клиентам.
 *
 * Запуск: npx tsx scripts/check-accounting.ts
 */
import { getFinanceSnapshot } from "../src/lib/finance";
import { getLeaderboard } from "../src/lib/leaderboard";
import { MONEY_EPSILON } from "../src/lib/constants";

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

/**
 * Заявка так, как её отдаёт listOrdersWithItems: сумма позиций плюс сколько
 * денег получено. Флаг «оплачено целиком» выводим из суммы — ровно как
 * setOrderPayment в repo/orders.
 */
function order(
  orderId: string,
  client: string,
  manager: string,
  qty: number,
  price: number,
  paidAmount: number,
  extra: { promisedAt?: string; delivery?: string; note?: string; flowerType?: string } = {}
) {
  const total = qty * price;
  return {
    orderId,
    createdAt: extra.delivery ?? day(-5),
    managerEmail: manager,
    clientName: client,
    clientPhone: "+7 700 000 00 00",
    deliveryDate: extra.delivery ?? day(-5),
    status: "new",
    notes: "",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: paidAmount > 0 && paidAmount >= total - MONEY_EPSILON,
    paidAt: paidAmount > 0 ? day(-4) : "",
    paymentMethod: paidAmount > 0 ? "Каспи" : "",
    accountantEmail: "buh@x.kz",
    paidAmount,
    promisedAt: extra.promisedAt ?? "",
    collectionNote: extra.note ?? "",
    totalAmount: total,
    items: [
      {
        orderId,
        itemId: `${orderId}-I1`,
        flowerType: extra.flowerType ?? "rose",
        variety: "Prestige",
        grade: "60",
        quantity: qty,
        unitPrice: price,
        shippedQuantity: qty,
      },
    ],
  };
}

const users = [
  { email: "m1@x.kz", name: "Айгерим", role: "manager", farm: null, active: true },
  { email: "m2@x.kz", name: "Ержан", role: "manager", farm: null, active: true },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/users").listUsers>>;

const orders = [
  // Оплачена целиком.
  order("FULL", "Астана", "m1@x.kz", 1000, 200, 200_000),
  // Предоплата 300 000 из 800 000 — долг 500 000, а не 800 000.
  order("PART", "Караганда", "m1@x.kz", 1000, 800, 300_000),
  // Не оплачена вовсе, обещали заплатить позавчера — звонить в первую очередь.
  order("BROKEN", "Шымкент", "m2@x.kz", 100, 1000, 0, { promisedAt: day(-2), note: "Обещал в среду" }),
  // Не оплачена, обещали заплатить послезавтра — сегодня не трогаем.
  order("FUTURE", "Актобе", "m2@x.kz", 100, 500, 0, { promisedAt: day(2) }),
  // Переплата: пересчитали заявку по рекламации после оплаты.
  order("OVER", "Тараз", "m1@x.kz", 100, 100, 15_000),
];

async function main() {
  const snapshot = await getFinanceSnapshot("month", day(0), NOW, {
    orders: orders as never,
    users,
  });

  // --- Частичная оплата ----------------------------------------------------
  const rows = new Map(snapshot.orders.map((r) => [r.orderId, r]));
  check("предоплата не делает заявку оплаченной", rows.get("PART")!.paid, false);
  check("предоплата видна суммой", rows.get("PART")!.paidAmount, 300_000);
  check("долг — остаток, а не вся сумма", rows.get("PART")!.debt, 500_000);
  check("оплаченная целиком долга не имеет", rows.get("FULL")!.debt, 0);

  // Переплата не превращается в оплату: 15 000 при счёте 10 000 — это 10 000
  // закрытых и 5 000, которые придётся вернуть.
  check("переплата не считается выручкой", rows.get("OVER")!.overpaid, 5000);
  check("переплаченная заявка закрыта", rows.get("OVER")!.debt, 0);
  check("переплата видна в итоге", snapshot.overpaidTotal, 5000);

  // --- Итоги ---------------------------------------------------------------
  const total = 200_000 + 800_000 + 100_000 + 50_000 + 10_000;
  check("оформлено за месяц", snapshot.totals.amount, total);
  check("получено денег", snapshot.totals.paidAmount, 200_000 + 300_000 + 10_000);
  check("ждём оплату", snapshot.totals.unpaidAmount, total - (200_000 + 300_000 + 10_000));
  check("заявок оплачено целиком", snapshot.totals.paidOrders, 2);
  check("заявок оплачено частично", snapshot.totals.partlyPaidOrders, 1);
  check(
    "по дням сходится с итогом",
    Math.round(snapshot.daily.reduce((s, d) => s + d.paid + d.unpaid, 0)),
    total
  );

  // --- Долги ---------------------------------------------------------------
  check("долг всего", snapshot.debtTotal, 500_000 + 100_000 + 50_000);
  const byClient = new Map(snapshot.debts.map((d) => [d.clientName, d.amount]));
  check("клиент с предоплатой должен остаток", byClient.get("Караганда"), 500_000);
  check("полностью оплаченный клиент в долгах не значится", byClient.has("Астана"), false);

  // --- Кому звонить сегодня ------------------------------------------------
  check(
    "порядок звонков: сначала обещал и не заплатил",
    snapshot.calls.map((c) => c.orderId),
    ["BROKEN", "PART", "FUTURE"]
  );
  check("нарушенное обещание помечено", snapshot.calls[0].promiseState, "broken");
  check("объяснение словами, а не кодом", snapshot.calls[0].why.startsWith("Обещал заплатить"), true);
  check("заметка бухгалтера сохранилась", snapshot.calls[0].collectionNote, "Обещал в среду");
  check(
    "обещавший на будущее — в конце и помечен",
    snapshot.calls[snapshot.calls.length - 1].promiseState,
    "future"
  );
  check(
    "в звонках только долги",
    snapshot.calls.every((c) => c.debt > 0),
    true
  );
  check("панель оплаты знает сумму заявки", snapshot.calls[1].amount, 800_000);

  // --- Бонус от оплаченной доли -------------------------------------------
  // Роза — 1,5 %. У Айгерим оплачено 200 000 целиком плюс 300 000 предоплаты
  // плюс 10 000 из переплаченной (сверх счёта бонус не начисляется).
  const board = await getLeaderboard("month", day(0), NOW, {
    orders: orders as never,
    users,
    plans: new Map(),
  });
  const aigerim = board.rows.find((r) => r.managerEmail === "m1@x.kz")!;
  check("бонус считается от полученных денег", Math.round(aigerim.paidAmount), 510_000);
  check("бонус розы 1,5 %", Math.round(aigerim.bonus), Math.round(510_000 * 0.015));
  check("неоплаченная часть ждёт", Math.round(aigerim.pendingAmount), 500_000);
  check(
    "ждущий бонус — с неоплаченной части",
    Math.round(aigerim.pendingBonus),
    Math.round(500_000 * 0.015)
  );
  check("стебли не дробятся", Number.isInteger(aigerim.paidStems), true);

  const erzhan = board.rows.find((r) => r.managerEmail === "m2@x.kz")!;
  check("без оплат бонуса нет", erzhan.bonus, 0);

  // --- Копеечный допуск ----------------------------------------------------
  // После пересчёта сумма может стать 799 999,5 — заявка обязана закрыться.
  const rounded = await getFinanceSnapshot("month", day(0), NOW, {
    orders: [order("EPS", "Копейка", "m1@x.kz", 1, 100_000.4, 100_000)] as never,
    users,
  });
  check("копейка не держит заявку в долгах", rounded.orders[0].paid, true);
  check("и в звонки не попадает", rounded.calls.length, 0);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
