/*
 * Проверка «Оплаты → Аналитика» (`src/lib/financeAnalytics.ts`) на выдуманной
 * базе с известными числами.
 * Запуск: npx tsx scripts/check-finance-analytics.ts
 */
import { buildFinanceAnalytics } from "../src/lib/financeAnalytics";
import type { OrderWithItems, Payment } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

const order = (
  id: string,
  created: string,
  delivery: string,
  manager: string,
  items: [string, number, number][],
  extra: Partial<OrderWithItems> = {}
): OrderWithItems =>
  ({
    orderId: id, createdAt: `${created}T10:00:00`, managerEmail: manager, clientId: `C-${id}`, clientName: `Клиент ${id}`,
    clientPhone: "", deliveryDate: delivery, status: "new", notes: "", paidAmount: 0, paidAt: "", paidRoseFarm: 0,
    paidEsentai: 0, paymentMethod: "", promisedAt: "", collectionNote: "", direction: "", kind: "", retail: "",
    invoiceSentAt: "", invoiceNote: "", realization1c: "", clientPaymentTerms: "",
    items: items.map(([flowerType, quantity, unitPrice], i) => ({
      itemId: `${id}-${i}`, orderId: id, flowerType, variety: "X", grade: "60", quantity, unitPrice, shippedQuantity: 0,
    })),
    ...extra,
  }) as unknown as OrderWithItems;

let pn = 0;
const pay = (orderId: string, date: string, amount: number, method: string, farm = ""): Payment => ({
  paymentId: `P${++pn}`, createdAt: `${date}T12:00:00`, orderId, date, amount, farm, method, accountantEmail: "b@x", note: "",
});

const orders: OrderWithItems[] = [
  // Оплачена целиком через 2 дня после доставки.
  order("O1", "2026-09-02", "2026-09-03", "m1@x", [["rose", 100, 200]], {
    paidAmount: 20000, paidRoseFarm: 20000, paidAt: "2026-09-05", invoiceSentAt: "2026-09-02", clientPaymentTerms: "Предоплата",
  }),
  // Смешанная: Есентай заплатил, Rose Farm — нет; обещали до 20-го и не заплатили.
  order("O2", "2026-09-10", "2026-09-12", "m1@x", [["rose", 50, 200], ["chrysanthemum", 50, 400]], {
    paidAmount: 20000, paidEsentai: 20000, paidAt: "2026-09-11", promisedAt: "2026-09-20", clientPaymentTerms: "Отсрочка 7 дней",
  }),
  // Августовская, оплачена одной суммой до журнала — 2 сентября.
  order("O3", "2026-08-20", "2026-08-21", "m2@x", [["chrysanthemum", 100, 300]], {
    paidAmount: 30000, paidEsentai: 30000, paidAt: "2026-09-02", paymentMethod: "Оплата по реквизитам",
  }),
  // Доставка впереди — долг есть, но не просрочен.
  order("O4", "2026-09-22", "2026-09-26", "m2@x", [["rose", 10, 200]]),
  // Отменённая с платежом — не в счёт.
  order("O5", "2026-09-05", "2026-09-06", "m1@x", [["rose", 10, 100]], { status: "cancelled", paidAmount: 1000, paidAt: "2026-09-05" } as never),
  // Опт на город: счёта нет, поступление есть.
  order("O6", "2026-09-15", "2026-09-16", "rop@x", [["rose", 500, 0]], { kind: "region", direction: "Астана", paidAmount: 50000, paidAt: "2026-09-18" }),
  // Наш магазин — вне денег.
  order("O7", "2026-09-15", "2026-09-16", "r@x", [["rose", 100, 100]], { retail: "almaty" }),
  // Реализация (пожарка): остаток — не долг.
  order("O8", "2026-09-15", "2026-09-15", "m2@x", [["rose", 100, 100]], { direction: "Пожарка", paidAmount: 3000, paidRoseFarm: 3000, paidAt: "2026-09-16" }),
  // Предоплата: заплатили до доставки.
  order("O9", "2026-09-18", "2026-09-20", "m1@x", [["rose", 10, 100]], { paidAmount: 1000, paidRoseFarm: 1000, paidAt: "2026-09-18" }),
];
const payments: Payment[] = [
  pay("O1", "2026-09-05", 20000, "Каспи"),
  pay("O2", "2026-09-11", 20000, "Наличные", "esentai"),
  pay("O5", "2026-09-05", 1000, "Каспи"),
  pay("O6", "2026-09-18", 50000, "Наличные"),
  pay("O8", "2026-09-16", 3000, "Каспи"),
  pay("O9", "2026-09-18", 1000, "Каспи"),
  pay("NOPE", "2026-09-18", 777, "Каспи"), // платёж без заявки
];
const names = new Map([["m1@x", "Эмиль"], ["m2@x", "Ильяс"]]);
const a = buildFinanceAnalytics({ orders, payments, nameByEmail: names, period: "2026-09", today: "2026-09-24" });
const c = a.current;

check("выставлено без отмен, магазина и опта", c.billed, 20000 + 30000 + 2000 + 10000 + 1000);
check("заявок со счётом", c.orders, 5);
check("собрано по счетам месяца", c.collected, 20000 + 20000 + 0 + 3000 + 1000);
check("поступило за месяц: журнал + старая сумма + опт", c.cashIn, 20000 + 20000 + 30000 + 50000 + 3000 + 1000);
check("из него опт на город", c.cashInRegions, 50000);
check("срок оплаты: медиана 0, 2, 12", c.daysToPay, 2);
check("закрыто в месяце и из них до доставки", [c.closedOrders, c.prepaidOrders], [3, 1]);
check("прошлый месяц: выставлено", a.previous.billed, 30000);
check("прошлый месяц: поступлений не было", a.previous.cashIn, 0);

check("долг сейчас", a.debt.total, 10000 + 2000);
check("просрочено", a.debt.overdue, 10000);
check("должников", [a.debt.clients, a.debt.orders], [2, 2]);
check("сорванные обещания", [a.debt.brokenPromises, a.debt.brokenAmount], [1, 10000]);
check("реализация — не долг", a.debt.onConsignment, 7000);
check(
  "возраст долга",
  a.debt.aging.filter((b) => b.amount > 0).map((b) => [b.key, b.amount]),
  [["ahead", 2000], ["8-14", 10000]]
);
check("возраст долга сходится с долгом", a.debt.aging.reduce((s, b) => s + b.amount, 0), a.debt.total);

const m1 = a.byManager.find((r) => r.label === "Эмиль")!;
const m2 = a.byManager.find((r) => r.label === "Ильяс")!;
check("Эмиль: выставлено, собрано, поступило", [m1.billed, m1.collected, m1.cashIn], [51000, 41000, 41000]);
check("Эмиль: долг и просрочка", [m1.debt, m1.overdue], [10000, 10000]);
check("Ильяс: выставлено и к прошлому", [m2.billed, m2.prevBilled], [12000, 30000]);
check("Ильяс: поступило (август оплачен в сентябре)", m2.cashIn, 33000);
check("доли менеджеров дают 100 %", Math.round(a.byManager.reduce((s, r) => s + r.share, 0)), 100);
check("опт на город не попал в менеджеров", a.byManager.some((r) => r.key === "rop@x"), false);

const rf = a.byCompany.find((r) => r.key === "rose_farm")!;
const es = a.byCompany.find((r) => r.key === "esentai")!;
check("компании по порядку", a.byCompany.map((r) => r.key), ["rose_farm", "esentai"]);
check("Rose Farm: выставлено и собрано", [rf.billed, rf.collected], [43000, 24000]);
check("Есентай: выставлено и собрано", [es.billed, es.collected], [20000, 20000]);
check("компании: выставлено = итог", rf.billed + es.billed, c.billed);
check("Rose Farm: долг — роза смешанной заявки", [rf.debt, rf.overdue], [12000, 10000]);
check("компании: поступило", [rf.cashIn, es.cashIn], [74000, 50000]);
check("компании: поступило = итог", rf.cashIn + es.cashIn, c.cashIn);

const byMethod = Object.fromEntries(a.byMethod.map((r) => [r.key, r.cashIn]));
check("способы оплаты", byMethod, { "Наличные": 70000, "Оплата по реквизитам": 30000, "Каспи": 24000 });

const terms = Object.fromEntries(a.byTerms.map((r) => [r.key, r.debt]));
check("долг по условиям клиента", terms["Отсрочка 7 дней"], 10000);

check(
  "недели: выставлено",
  a.weeks.map((w) => w.billed),
  [20000, 30000, 11000, 2000, 0]
);
check("недели: поступило", a.weeks.map((w) => w.cashIn), [50000, 20000, 54000, 0, 0]);
check("последняя неделя — впереди", a.weeks.map((w) => w.future), [false, false, false, false, true]);

check("первым — должник с просрочкой", a.debtors[0].name, "Клиент O2");
check("у него сорвано обещание", a.debtors[0].brokenPromise, true);
check("отметка «счёт отправлен»", a.invoiceMarked, 1);

const empty = buildFinanceAnalytics({ orders: [], payments: [], nameByEmail: names, period: "2026-09", today: "2026-09-24" });
check("пустая база: без деления на ноль", [empty.current.billed, empty.current.daysToPay, empty.debt.total, empty.byManager.length], [0, null, 0, 0]);

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
