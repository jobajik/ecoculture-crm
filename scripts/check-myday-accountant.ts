/**
 * «Мой день» бухгалтера: порядок звонков (сорванное обещание → просрочка → срок сегодня; «обещал позже» и
 * «срок не вышел» в список не идут), «пришло сегодня» — по дню ПОСТУПЛЕНИЯ и с долей Kaspi, счета без отметки —
 * из дорожки «Нет отметки о счёте», строка касс — по подключённым компаниям.
 */
import { buildAccountantDay, callReason, kaspiLines } from "../src/lib/myDay/accountant";
import { buildPaymentStatus } from "../src/lib/paymentStatus";
import type { CallRow, FinanceOrderRow } from "../src/lib/finance";
import type { KaspiInvoice } from "../src/lib/types";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-10-19";

const call = (p: Partial<CallRow> & { orderId: string }): CallRow =>
  ({
    code: p.orderId.slice(-5),
    clientName: "Клиент",
    clientPhone: "+77010000000",
    managerName: "Ильяс",
    deliveryDate: "2026-10-10",
    amount: 100_000,
    paidAmount: 0,
    debt: 100_000,
    days: 9,
    overdue: false,
    promisedAt: "",
    promiseState: "none",
    collectionNote: "",
    farms: [],
    invoiceSentAt: "",
    why: "",
    payments: [],
    realizations: [],
    paymentMethod: "",
    status: "new",
    consignment: false,
    paymentTerms: "",
    dueDate: "",
    remindedAt: "",
    ...p,
  }) as CallRow;

const row = (p: Partial<FinanceOrderRow> & { orderId: string }): FinanceOrderRow =>
  ({
    code: p.orderId.slice(-5),
    createdAt: "2026-10-10T10:00:00",
    createdDate: "2026-10-10",
    deliveryDate: "2026-10-12",
    clientName: "Клиент",
    clientPhone: "",
    managerName: "Ильяс",
    managerEmail: "i@x.kz",
    status: "new",
    amount: 100_000,
    stems: 100,
    managerConfirmed: true,
    paid: false,
    paidAt: "",
    paymentMethod: "",
    paidAmount: 0,
    debt: 100_000,
    consignment: false,
    onConsignment: 0,
    realization1c: "",
    realizations: [],
    payments: [],
    byFlower: [],
    overpaid: 0,
    promisedAt: "",
    collectionNote: "",
    readyToCollect: false,
    invoiceSentAt: "",
    invoiceNote: "",
    stage: "not_invoiced",
    positions: "",
    farms: [{ farm: "esentai", amount: 100_000, paidAmount: 0, flowers: [] }],
    ...p,
  }) as unknown as FinanceOrderRow;

// --- Причина звонка -----------------------------------------------------------
check("сорванное обещание", callReason(call({ orderId: "A", promiseState: "broken", overdue: true }), TODAY), "broken");
check("просрочка без обещания", callReason(call({ orderId: "B", overdue: true }), TODAY), "overdue");
check("обещал сегодня", callReason(call({ orderId: "C", promiseState: "today" }), TODAY), "due_today");
check("срок по отсрочке сегодня", callReason(call({ orderId: "D", dueDate: TODAY }), TODAY), "due_today");
check("обещал позже — не звоним", callReason(call({ orderId: "E", promiseState: "future", overdue: true }), TODAY), null);
check("срок не вышел — не звоним", callReason(call({ orderId: "F", dueDate: "2026-10-25" }), TODAY), null);

// --- Доска целиком ---------------------------------------------------------------
const calls = [
  call({ orderId: "ORD-1-DUE01", dueDate: TODAY, debt: 50_000 }),
  call({ orderId: "ORD-1-OVER1", overdue: true, days: 3, debt: 70_000 }),
  call({ orderId: "ORD-1-LATER", promiseState: "future", promisedAt: "2026-10-22", debt: 90_000 }),
  call({ orderId: "ORD-1-OVER2", overdue: true, days: 8, debt: 60_000 }),
  call({ orderId: "ORD-1-BROKN", promiseState: "broken", promisedAt: "2026-10-17", overdue: true, days: 5, debt: 200_000 }),
  call({ orderId: "ORD-1-FRESH", days: 1, debt: 30_000 }),
];
const openRows = [
  row({ orderId: "ORD-1-BROKN", debt: 200_000, amount: 200_000 }),
  row({ orderId: "ORD-1-OVER1", debt: 70_000, amount: 70_000, invoiceNote: "неверный телефон" }),
  row({ orderId: "ORD-1-OVER2", debt: 60_000, amount: 60_000, invoiceSentAt: "2026-10-12" }),
  row({ orderId: "ORD-1-KASPI", debt: 40_000, amount: 40_000 }),
  row({ orderId: "ORD-1-FRESH", debt: 30_000, amount: 30_000 }),
];
const recentPaidRows = [
  row({
    orderId: "ORD-1-PAID1",
    debt: 0,
    paidAmount: 120_000,
    amount: 120_000,
    payments: [
      { paymentId: "P1", date: TODAY, amount: 120_000, farm: "esentai", method: "Каспи", enteredOn: TODAY },
      { paymentId: "P0", date: "2026-10-18", amount: 5_000, farm: "esentai", method: "Каспи", enteredOn: "2026-10-18" },
    ],
  }),
  row({
    orderId: "ORD-1-PAID2",
    debt: 0,
    paidAmount: 80_000,
    amount: 80_000,
    payments: [{ paymentId: "P2", date: TODAY, amount: 80_000, farm: "rose_farm", method: "Наличные", enteredOn: TODAY }],
  }),
];
const invoices: KaspiInvoice[] = [
  { invoiceId: "K1", orderId: "ORD-1-KASPI", farm: "esentai", amount: 40_000, status: "expired", createdAt: "2026-10-15T10:00:00", paymentId: "", phone: "", errorCode: "", errorMessage: "", sandbox: false } as unknown as KaspiInvoice,
  { invoiceId: "K2", orderId: "ORD-1-PAID1", farm: "esentai", amount: 120_000, status: "paid", createdAt: "2026-10-19T08:00:00", paymentId: "P1", phone: "", errorCode: "", errorMessage: "", sandbox: false } as unknown as KaspiInvoice,
];
const board = buildPaymentStatus(openRows, recentPaidRows, invoices, TODAY);
const day = buildAccountantDay({
  calls,
  openRows,
  debtOverdueTotal: 330_000,
  board,
  cash: { rows: [{ flowerType: "chrysanthemum", amount: 120_000 }, { flowerType: "rose", amount: 80_000 }, { flowerType: "eustoma", amount: 0 }], total: 200_000, unsplit: 0 },
  remindedByOrder: new Map([["ORD-1-OVER2", "2026-10-17"]]),
  kaspiHealth: [{ farm: "esentai", state: "ok" }],
  kaspiConfigured: ["esentai"],
  todayKey: TODAY,
});

check("порядок звонков: сорванное обещание, просрочка (старая первой), срок сегодня", day.calls.map((c) => c.code), ["BROKN", "OVER2", "OVER1", "DUE01"]);
check("обещавшие позже скрыты, но посчитаны", day.promisedLater, 1);
check("напоминание в WhatsApp подтянуто", day.calls.find((c) => c.code === "OVER2")?.remindedAt, "2026-10-17");
check("пришло сегодня — только платежи за сегодня", day.tiles.paidToday, { amount: 200_000, kaspiAmount: 120_000, count: 2 });
check("ждут оплаты — все долги", day.tiles.waiting, { amount: 400_000, orders: 5 });
check("просрочено: сумма со страницы долгов, заявок и сорванных обещаний", day.tiles.overdue, { amount: 330_000, orders: 3, brokenPromises: 1 });
check("Kaspi не дошёл", day.tiles.kaspiProblems, { count: 1, amount: 40_000 });
check("счета без отметки — без Kaspi-проблемы и без отправленного", day.invoices.map((i) => i.code).sort(), ["BROKN", "FRESH", "OVER1"]);
check("заметка «почему не ушёл» видна", day.invoices.find((i) => i.code === "OVER1")?.note, "неверный телефон");
check("платежи сегодня — Kaspi помечен", day.payments.map((p) => `${p.code}:${p.viaKaspi}`), ["PAID1:true", "PAID2:false"]);
check("по цветкам — без нулевых", day.byFlower.map((f) => `${f.label} ${f.amount}`), ["Хризантема 120000", "Роза 80000"]);
check("кассы: Rose Farm не подключена, Есентай работает", day.kaspi.map((k) => k.state), ["off", "ok"]);
check("касса сломана — так и написано", kaspiLines([{ farm: "esentai", state: "broken", reason: "вход кассира сброшен" }], ["esentai"])[1].text, "Есентай Агро Хим — касса отключилась: вход кассира сброшен");
check("ApiPay не ответил — «подключена», без тревоги", kaspiLines([{ farm: "esentai", state: "unknown" }], ["esentai"])[1].state, "unknown");

if (fails > 0) {
  console.log(`\nПровалено проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
