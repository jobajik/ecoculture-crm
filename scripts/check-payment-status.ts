/*
 * «Статус оплат» (`src/lib/paymentStatus.ts`) и выбор номера для Kaspi-счёта
 * (`kaspiPhoneOptions` в `src/lib/kaspiInvoice.ts`).
 * Запуск: npx tsx scripts/check-payment-status.ts
 */
import { buildPaymentStatus, statusLaneOf } from "../src/lib/paymentStatus";
import { kaspiPhoneOptions, kaspiTrackerStep, prettyKaspiPhone, waitingWords } from "../src/lib/kaspiInvoice";
import type { FinanceOrderRow } from "../src/lib/finance";
import type { KaspiInvoice } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

// --- Номера клиента -------------------------------------------------------------
check(
  "номера: по порядку, без повторов и городских",
  kaspiPhoneOptions([
    ["+7 701 555 20 30", "Kaspi №1"],
    ["", "Kaspi №2"],
    ["8 727 255 20 30", "телефон заявки"],
    ["87015552030", "телефон клиента"],
    ["8 747 217 85 29", "телефон заявки"],
  ]),
  [
    { phone: "87015552030", label: "Kaspi №1, телефон клиента" },
    { phone: "87472178529", label: "телефон заявки" },
  ]
);
check("номеров нет — пустой список", kaspiPhoneOptions([[null, "Kaspi №1"], ["abc", "телефон заявки"]]), []);
check("номер красиво", prettyKaspiPhone("87472178529"), "8 747 217 85 29");
check("шаги счёта", ["processing", "pending", "paid", "expired", "error", "cancelling"].map(kaspiTrackerStep), [1, 2, 3, 0, 0, 2]);
const now = new Date("2026-09-25T12:00:00Z");
check("ждёт: минуты", waitingWords("2026-09-25T11:48:00Z", now), "12 мин");
check("ждёт: часы", waitingWords("2026-09-25T09:00:00Z", now), "3 ч");
check("ждёт: дни", waitingWords("2026-09-23T09:00:00Z", now), "2 дн.");

// --- Дорожки -----------------------------------------------------------------------
function row(p: Partial<FinanceOrderRow> & { orderId: string }): FinanceOrderRow {
  const amount = p.amount ?? 1000;
  const paidAmount = p.paidAmount ?? 0;
  return {
    createdAt: "2026-09-20T10:00:00Z",
    createdDate: "2026-09-20",
    deliveryDate: "2026-09-21",
    clientName: "Клиент",
    clientPhone: "",
    managerName: "Алия",
    managerEmail: "a@x",
    status: "new",
    amount,
    stems: 10,
    managerConfirmed: true,
    paid: paidAmount >= amount,
    paidAt: "",
    paymentMethod: "",
    paidAmount,
    debt: Math.max(0, amount - paidAmount),
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
    stage: "not_sent",
    code: p.orderId.slice(-5),
    positions: "",
    farms: [{ farm: "esentai", farmLabel: "Есентай", amount, paidAmount } as never],
    ...p,
  } as FinanceOrderRow;
}
function inv(p: Partial<KaspiInvoice> & { invoiceId: string; orderId: string; status: string }): KaspiInvoice {
  return {
    createdAt: "2026-09-25T10:00:00Z",
    farm: "esentai",
    amount: 1000,
    phone: "87472178529",
    kaspiInvoiceId: "",
    errorCode: "",
    errorMessage: "",
    paidAt: "",
    paymentId: "",
    createdByEmail: "b@x",
    sandbox: false,
    updatedAt: "",
    ...p,
  };
}

check("без счёта и отметки — «нет отметки»", statusLaneOf(row({ orderId: "A" }), []).lane, "no_invoice");
check("отметка стоит — «счёт отправлен»", statusLaneOf(row({ orderId: "A", invoiceSentAt: "2026-09-24T10:00:00Z" }), []).lane, "invoiced");
check("часть пришла — «частично»", statusLaneOf(row({ orderId: "A", paidAmount: 300 }), []).lane, "partial");
check(
  "счёт в Kaspi ждёт — «ждём в Kaspi» (сильнее отметки)",
  statusLaneOf(row({ orderId: "A", invoiceSentAt: "2026-09-24" }), [inv({ invoiceId: "1", orderId: "A", status: "pending" })]).lane,
  "kaspi_pending"
);
check(
  "последний счёт истёк — «Kaspi не дошёл»",
  statusLaneOf(row({ orderId: "A", invoiceSentAt: "2026-09-24" }), [
    inv({ invoiceId: "1", orderId: "A", status: "expired" }),
  ]).lane,
  "kaspi_problem"
);
check(
  "истёк старый, новый ждёт — «ждём в Kaspi»",
  statusLaneOf(row({ orderId: "A" }), [
    inv({ invoiceId: "1", orderId: "A", status: "expired", createdAt: "2026-09-24T10:00:00Z" }),
    inv({ invoiceId: "2", orderId: "A", status: "pending", createdAt: "2026-09-25T10:00:00Z" }),
  ]).lane,
  "kaspi_pending"
);
check(
  "оплачена часть счётом, остаток ждёт — «частично», не проблема",
  statusLaneOf(row({ orderId: "A", paidAmount: 500 }), [inv({ invoiceId: "1", orderId: "A", status: "paid", amount: 500 })]).lane,
  "partial"
);
check(
  "ошибка по компании, которая уже оплачена, — не проблема",
  statusLaneOf(
    row({
      orderId: "A",
      amount: 2000,
      paidAmount: 1000,
      farms: [
        { farm: "rose_farm", farmLabel: "Rose Farm", amount: 1000, paidAmount: 0 },
        { farm: "esentai", farmLabel: "Есентай", amount: 1000, paidAmount: 1000 },
      ] as never,
    }),
    [inv({ invoiceId: "1", orderId: "A", status: "error", farm: "esentai" })]
  ).lane,
  "partial"
);

// --- Доска ---------------------------------------------------------------------------
const board = buildPaymentStatus(
  [
    row({ orderId: "ORD-OLD01", deliveryDate: "2026-09-10" }),
    row({ orderId: "ORD-NEW01", deliveryDate: "2026-09-24" }),
    row({ orderId: "ORD-KAS01" }),
    row({ orderId: "ORD-PAID1", paidAmount: 1000 }),
  ],
  [
    row({
      orderId: "ORD-TODAY",
      paidAmount: 1000,
      payments: [
        { paymentId: "PAY-1", date: "2026-09-25", amount: 1000, farm: "esentai", method: "Каспи", enteredOn: "2026-09-25" },
        { paymentId: "PAY-0", date: "2026-09-24", amount: 50, farm: "esentai", method: "Наличные", enteredOn: "2026-09-24" },
      ],
    }),
  ],
  [
    inv({ invoiceId: "7", orderId: "ORD-KAS01", status: "pending" }),
    inv({ invoiceId: "8", orderId: "ORD-TODAY", status: "paid", paymentId: "PAY-1" }),
    inv({ invoiceId: "9", orderId: "ORD-X", status: "paid", sandbox: true, paymentId: "PAY-T" }),
  ],
  "2026-09-25"
);
const lane = (k: string) => board.lanes.find((l) => l.key === k)!;
check("оплаченная заявка в дорожки не попадает", board.lanes.reduce((s, l) => s + l.count, 0), 3);
check("давний долг сверху", lane("no_invoice").rows.map((r) => r.row.orderId), ["ORD-OLD01", "ORD-NEW01"]);
check("дней с доставки", lane("no_invoice").rows.map((r) => r.days), [15, 1]);
check("сумма дорожки", lane("no_invoice").amount, 2000);
check("Kaspi ждёт: счёт при строке", lane("kaspi_pending").rows[0]?.kaspi?.invoiceId, "7");
check("пришло сегодня — только сегодняшний платёж", [board.paidToday.amount, board.paidToday.count], [1000, 1]);
check("пришло сегодня — узнан Kaspi", [board.paidToday.kaspiAmount, board.paidToday.rows[0]?.viaKaspi], [1000, true]);
check("Kaspi за неделю без тестовых", board.kaspiWeek, { sent: 2, sentAmount: 2000, paid: 1, paidAmount: 1000 });

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
