/* Финансы бухгалтера: расчёт кода против ручного счёта. */
import { getFinanceSnapshot, periodRange } from "../src/lib/finance";
import { getPicklist } from "../src/lib/picklist";

// Вторник 8 сентября 2026. Неделя: Пн 7 — Вс 13. Месяц: 1–30 сентября.
const NOW = new Date("2026-09-08T12:00:00");

const users = [
  { email: "m1@x.kz", name: "Айгерим", role: "manager", farm: null, active: true },
  { email: "m2@x.kz", name: "Ержан", role: "manager", farm: null, active: true },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/users").listUsers>>;

function order(
  id: string,
  createdAt: string,
  client: string,
  manager: string,
  amountPerStem: number,
  qty: number,
  opts: {
    paid?: boolean;
    /** Частичная оплата: сколько денег реально получено. */
    paidAmount?: number;
    confirmed?: boolean;
    delivery?: string;
    type?: string;
    method?: string;
  } = {}
) {
  return {
    orderId: id,
    clientName: client,
    clientPhone: "7700",
    managerEmail: manager,
    status: "new",
    notes: "",
    deliveryDate: opts.delivery ?? createdAt.slice(0, 10),
    createdAt,
    managerConfirmed: opts.confirmed ?? false,
    managerConfirmedAt: "",
    // Флаг «оплачено целиком» — вывод из суммы, как и в самой программе.
    paid: opts.paidAmount !== undefined
      ? opts.paidAmount >= amountPerStem * qty
      : opts.paid ?? false,
    paidAmount:
      opts.paidAmount !== undefined ? opts.paidAmount : opts.paid ? amountPerStem * qty : 0,
    promisedAt: "",
    collectionNote: "",
    paidAt: opts.paid || opts.paidAmount ? createdAt : "",
    paymentMethod: opts.paid || opts.paidAmount ? opts.method ?? "Каспи" : "",
    accountantEmail: "",
    totalAmount: amountPerStem * qty,
    items: [
      {
        flowerType: opts.type ?? "rose",
        variety: "Prestige",
        grade: "60",
        quantity: qty,
        unitPrice: amountPerStem,
        shippedQuantity: 0,
      },
    ],
  };
}

const orders = [
  // --- вторник 8 сентября (день) ---
  order("A", "2026-09-08T09:00:00", "Клиент А", "m1@x.kz", 500, 100, { paid: true, confirmed: true }), // 50 000 оплачено
  order("B", "2026-09-08T10:00:00", "Клиент Б", "m2@x.kz", 300, 100, { confirmed: true }),             // 30 000 не оплачено
  order("C", "2026-09-08T11:00:00", "Клиент В", "m1@x.kz", 250, 40, { paid: true, method: "Наличные" }), // 10 000 оплачено, без подтверждения
  // --- понедельник 7 сентября (в неделю, не в день) ---
  order("D", "2026-09-07T10:00:00", "Клиент А", "m1@x.kz", 200, 100, { paid: true }),                   // 20 000
  // --- 3 сентября (в месяц, не в неделю); давняя доставка -> просроченный долг ---
  order("E", "2026-09-03T10:00:00", "Клиент Г", "m2@x.kz", 400, 25, { delivery: "2026-09-03" }),        // 10 000 долг
  // --- отменённая: не считается нигде ---
  { ...order("F", "2026-09-08T12:00:00", "Клиент Д", "m1@x.kz", 1000, 100), status: "cancelled" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/orders").listOrdersWithItems>>;

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

async function main() {
  // --- границы периодов ---
  check("неделя начинается с понедельника", periodRange("week", NOW).from, "2026-09-07");
  check("неделя кончается воскресеньем", periodRange("week", NOW).to, "2026-09-13");
  check("месяц: с 1 по 30", [periodRange("month", NOW).from, periodRange("month", NOW).to], ["2026-09-01", "2026-09-30"]);

  // --- ДЕНЬ: A(50k опл) + B(30k) + C(10k опл) = 90 000, оплачено 60 000 ---
  const day = await getFinanceSnapshot("day", undefined, NOW, { orders, users });
  check("день: сумма", day.totals.amount, 90_000);
  check("день: оплачено", day.totals.paidAmount, 60_000);
  check("день: ждём", day.totals.unpaidAmount, 30_000);
  check("день: заявок", day.totals.orders, 3);
  check("день: собираемость %", Math.round(day.totals.collectPercent), 67);
  check("день: отменённая не попала", day.orders.some((o) => o.orderId === "F"), false);
  check("день: готовых к сборке (обе галочки)", day.orders.filter((o) => o.readyToCollect).length, 1);

  // --- НЕДЕЛЯ: день + D(20k опл) = 110 000, оплачено 80 000 ---
  const week = await getFinanceSnapshot("week", undefined, NOW, { orders, users });
  check("неделя: сумма", week.totals.amount, 110_000);
  check("неделя: оплачено", week.totals.paidAmount, 80_000);
  check("неделя: дней в разбивке", week.daily.length, 7);
  check("неделя: сумма по дням = итогу", week.daily.reduce((s, d) => s + d.paid + d.unpaid, 0), 110_000);

  // --- МЕСЯЦ: неделя + E(10k долг) = 120 000, оплачено 80 000 ---
  const month = await getFinanceSnapshot("month", undefined, NOW, { orders, users });
  check("месяц: сумма", month.totals.amount, 120_000);
  check("месяц: оплачено", month.totals.paidAmount, 80_000);
  check("месяц: дней в разбивке", month.daily.length, 30);

  // --- ДОЛГИ: считаются по всей базе, а не за период ---
  // Не оплачены: B (30k, Клиент Б) и E (10k, Клиент Г). Итого 40 000.
  check("долг всего", day.debtTotal, 40_000);
  check("долгов по клиентам", day.debts.length, 2);
  check("долг Клиента Б", day.debts.find((d) => d.clientName === "Клиент Б")?.amount, 30_000);
  // E: доставка 3 сентября, сегодня 8-е -> 5 дней, порог 3 -> просрочен.
  const debtG = day.debts.find((d) => d.clientName === "Клиент Г");
  check("возраст долга Клиента Г, дней", debtG?.oldestDays, 5);
  check("долг Клиента Г просрочен", debtG?.overdue, true);
  // B: доставка сегодня -> 0 дней, не просрочен.
  check("долг Клиента Б не просрочен", day.debts.find((d) => d.clientName === "Клиент Б")?.overdue, false);
  check("просрочено всего", day.debtOverdueTotal, 10_000);

  // --- разрезы ---
  check("день: способы оплаты", day.byMethod.map((m) => [m.method, m.amount]).sort(), [["Каспи", 50_000], ["Наличные", 10_000]]);
  check(
    "день: по менеджерам",
    day.byManager.map((m) => [m.managerName, m.amount, m.paidAmount]),
    [["Айгерим", 60_000, 60_000], ["Ержан", 30_000, 0]]
  );

  // --- лист сборки видит галочки ---
  const pick = await getPicklist("2026-09-08", NOW, { orders, batches: [] as never, users }, null);
  check("лист: заявок на день", pick.totalOrders, 3);
  check("лист: не готовы", pick.notReadyOrders, 2);
  check("лист: готова только А", pick.orders.filter((o) => o.readyToCollect).map((o) => o.clientName), ["Клиент А"]);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
