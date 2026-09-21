/*
 * Платежи по одному, номер реализации 1С, реализация (пожарка) и порядок листа.
 *
 * Всё это — просьбы бухгалтера и РОПа из одного сообщения:
 *  - «при внесении следующей суммы её негде писать, не видно, какими частями
 *    была оплата, приходится к предыдущей сумме вручную добавлять последующую»;
 *  - «номера реализаций 1С в CRM», поиск по сумме и номеру;
 *  - «пожарка — это не продажи, там всегда будет висеть задолженность»;
 *  - «заявки не в алфавитном порядке, а по времени, поздние вверху».
 *
 * Запуск: npx tsx scripts/check-payments.ts
 */
import {
  addPaymentRefusal,
  cleanRealization,
  methodOfPayments,
  paymentHistory,
  splitPaymentLines,
  removePaymentRefusal,
  totalsAfter,
} from "../src/lib/payments";
import { isConsignment } from "../src/lib/orderKind";
import { isReadyToShip, notReadyReason } from "../src/lib/orderReady";
import { getFinanceSnapshot } from "../src/lib/finance";
import { byNewest, orderPicklistColumns } from "../src/lib/picklistOrder";
import { ORDER_PAYMENT_METHODS, ROLES, SHEET_HEADERS, SHEET_TABS } from "../src/lib/constants";
import { matchesOrderSearch } from "../src/lib/paymentStage";

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
const refused = (s: string) => s !== "";

// --- Схема: новая колонка в конце, новая вкладка на месте ------------------

check("Realization1C — последняя колонка Orders", SHEET_HEADERS[SHEET_TABS.ORDERS].slice(-1), [
  "Realization1C",
]);
check(
  "у журнала платежей есть сумма, день и компания",
  ["Amount", "Date", "Farm", "OrderID"].every((h) => SHEET_HEADERS[SHEET_TABS.PAYMENTS].includes(h)),
  true
);

// --- История платежей ------------------------------------------------------

const P = (id: string, date: string, amount: number, farm = "") => ({
  paymentId: id,
  date,
  amount,
  farm,
  method: "Каспи",
});

const h1 = paymentHistory(500_000, [P("B", "2026-09-12", 200_000), P("A", "2026-09-05", 300_000)]);
check("платежи по дате, старые сверху", h1.rows.map((r) => r.paymentId), ["A", "B"]);
check("сумма платежей", h1.recorded, 500_000);
check("всё сходится — строки «вне журнала» нет", h1.unrecorded, 0);

const h2 = paymentHistory(800_000, [P("A", "2026-09-05", 300_000)]);
check("старая оплата одним числом видна отдельно", h2.unrecorded, 500_000);

const h3 = paymentHistory(250_000, [P("A", "2026-09-05", 300_000)]);
check("итог исправили вниз — разница с минусом", h3.unrecorded, -50_000);
check("копейка не рождает строку", paymentHistory(100_000.4, [P("A", "2026-09-05", 100_000)]).unrecorded, 0);

// --- Кто и что может внести ------------------------------------------------

const base = {
  role: ROLES.ACCOUNTANT,
  amount: 200_000,
  date: "2026-09-12",
  today: "2026-09-14",
  method: "Каспи",
  farm: "",
  invoiceFarms: ["rose_farm"],
  status: "new",
  noInvoice: false,
};
check("бухгалтер вносит платёж", addPaymentRefusal(base), "");
check("админ тоже", addPaymentRefusal({ ...base, role: ROLES.ADMIN }), "");
check(
  "РОП — нет, он только смотрит",
  refused(addPaymentRefusal({ ...base, role: ROLES.SALES_HEAD })),
  true
);
check("менеджер — нет", refused(addPaymentRefusal({ ...base, role: ROLES.MANAGER })), true);
check("пустая роль — нет", refused(addPaymentRefusal({ ...base, role: "" })), true);
check("ноль не вносится", refused(addPaymentRefusal({ ...base, amount: 0 })), true);
check("минус не вносится", refused(addPaymentRefusal({ ...base, amount: -5 })), true);
check("день из будущего нельзя", refused(addPaymentRefusal({ ...base, date: "2026-09-15" })), true);
check("задним числом можно", addPaymentRefusal({ ...base, date: "2026-08-30" }), "");
check("без дня нельзя", refused(addPaymentRefusal({ ...base, date: "" })), true);
check("способ из списка", refused(addPaymentRefusal({ ...base, method: "Бартер" })), true);
check("по отменённой нельзя", refused(addPaymentRefusal({ ...base, status: "cancelled" })), true);
check("по отгруженной — можно: долг гасят после отгрузки", addPaymentRefusal({ ...base, status: "shipped" }), "");
check("по заявке без счёта нельзя", refused(addPaymentRefusal({ ...base, noInvoice: true })), true);
const mixed = { ...base, invoiceFarms: ["rose_farm", "esentai"] };
check("смешанная: без компании нельзя", refused(addPaymentRefusal(mixed)), true);
check("смешанная: с компанией можно", addPaymentRefusal({ ...mixed, farm: "esentai" }), "");
check(
  "чужая компания в обычной заявке — нет",
  refused(addPaymentRefusal({ ...base, farm: "esentai" })),
  true
);

// --- Удаление ошибочного платежа ------------------------------------------

const rm = { role: ROLES.ACCOUNTANT, status: "new", enteredOn: "2026-09-10", today: "2026-09-14" };
check("по открытой заявке удалить можно", removePaymentRefusal(rm), "");
check(
  "по отгруженной — только внесённый сегодня",
  [
    refused(removePaymentRefusal({ ...rm, status: "shipped" })),
    removePaymentRefusal({ ...rm, status: "shipped", enteredOn: "2026-09-14" }),
  ],
  [true, ""]
);
check("по отменённой — нет", refused(removePaymentRefusal({ ...rm, status: "cancelled" })), true);
check("РОП удалить не может", refused(removePaymentRefusal({ ...rm, role: ROLES.SALES_HEAD })), true);

// --- Итог после платежа: складывает сервер, а не бухгалтер -----------------

check(
  "второй платёж ДОБАВЛЯЕТСЯ к первому",
  totalsAfter(300_000, { rose_farm: 300_000 }, "", 200_000),
  { paidAmount: 500_000, byFarm: { rose_farm: 500_000 } }
);
check(
  "смешанная: деньги ложатся на свою компанию",
  totalsAfter(100_000, { rose_farm: 100_000, esentai: 0 }, "esentai", 50_000),
  { paidAmount: 150_000, byFarm: { rose_farm: 100_000, esentai: 50_000 } }
);
check(
  "удаление вычитает и не уводит в минус",
  totalsAfter(100_000, { rose_farm: 100_000 }, "", -150_000),
  { paidAmount: 0, byFarm: { rose_farm: 0 } }
);
check("заявка без компаний — меняется только итог", totalsAfter(0, {}, "", 1000), {
  paidAmount: 1000,
  byFarm: {},
});

// --- Номер реализации 1С ---------------------------------------------------

check("пробелы по краям и двойные убираются", cleanRealization("  РН   000123 "), "РН 000123");
check("пусто — пусто", cleanRealization(undefined), "");
check("длинное обрезается", cleanRealization("x".repeat(100)).length, 40);

// --- Реализация (пожарка) --------------------------------------------------

const fire = { direction: "Пожарка", retail: "", kind: "" };
check("пожарка — на реализации", isConsignment(fire), true);
check("обычная заявка — нет", isConsignment({ direction: "Астана", retail: "", kind: "" }), false);
check("Алматы (пусто) — нет", isConsignment({ direction: "", retail: "", kind: "" }), false);
check("объём на город «Пожарка» — не реализация, счёта там нет", isConsignment({ ...fire, kind: "region" }), false);

const gate = { managerConfirmed: true, paid: false, paidAmount: 0, totalAmount: 100_000, ...fire };
check("пожарку отгружают без оплаты — платят за проданное", isReadyToShip(gate), true);
check("но подтверждение менеджера нужно", isReadyToShip({ ...gate, managerConfirmed: false }), false);
check("и причина говорит только про менеджера", notReadyReason({ ...gate, managerConfirmed: false }).includes("оплат"), false);
check(
  "обычную заявку без оплаты по-прежнему не отгружают",
  isReadyToShip({ ...gate, direction: "Астана" }),
  false
);

// --- Порядок листа сборки: свежие первыми ----------------------------------

const cols = orderPicklistColumns([
  { orderId: "A", createdAt: "2026-09-14T08:00:00Z", managerEmail: "m1" },
  { orderId: "B", createdAt: "2026-09-14T11:00:00Z", managerEmail: "m2" },
  { orderId: "C", createdAt: "2026-09-14T10:00:00Z", managerEmail: "m1" },
  { orderId: "D", createdAt: "2026-09-14T09:00:00Z", managerEmail: "m2" },
]);
check(
  "менеджер со свежей заявкой первым, внутри — от новой к старой",
  cols.map((c) => c.orderId),
  ["B", "D", "C", "A"]
);
check(
  "при равном времени порядок не прыгает",
  [
    { orderId: "X1", createdAt: "t" },
    { orderId: "X2", createdAt: "t" },
  ]
    .sort(byNewest)
    .map((o) => o.orderId),
  ["X2", "X1"]
);

// --- Смешанная оплата: часть картой, часть наличными ------------------------

check(
  "две части разными способами — два платежа",
  splitPaymentLines([
    { amount: 70_000, method: "Каспи" },
    { amount: 50_000, method: "Наличные" },
  ]),
  { lines: [{ method: "Каспи", amount: 70_000 }, { method: "Наличные", amount: 50_000 }], refusal: "" }
);
check(
  "один способ дважды склеивается",
  splitPaymentLines([
    { amount: 10_000, method: "Наличные" },
    { amount: 5_000, method: "Наличные" },
  ]).lines,
  [{ method: "Наличные", amount: 15_000 }]
);
check("пустая строка выбрасывается", splitPaymentLines([{ amount: 100, method: "Каспи" }, { amount: 0, method: "" }]).lines.length, 1);
check("способ «Смешанная» у одного платежа нельзя", refused(splitPaymentLines([{ amount: 100, method: "Смешанная" }]).refusal), true);
check("минус в части — отказ", refused(splitPaymentLines([{ amount: -5, method: "Каспи" }]).refusal), true);
check("ни одной части — отказ", refused(splitPaymentLines([]).refusal), true);
check("вид оплаты по платежам: один способ", methodOfPayments(["Каспи", "Каспи"]), "Каспи");
check("вид оплаты по платежам: разные — смешанная", methodOfPayments(["Каспи", "Наличные"]), "Смешанная");
check("вид оплаты: платежей нет — пусто", methodOfPayments([]), "");
check("менеджер может выбрать «Смешанная»", ORDER_PAYMENT_METHODS.includes("Смешанная"), true);

// --- Поиск по части суммы («итог 120 000, пришла оплата на 60 000») ---------

const mixedRow = {
  orderId: "ORD-1757924831",
  clientName: "Салон",
  managerName: "Айгерим",
  amount: 120_000,
  amounts: [60_000, 60_000],
};
check("находится по сумме хризантемы", matchesOrderSearch(mixedRow, "60 000"), true);
check("и по итогу, как раньше", matchesOrderSearch(mixedRow, "120000"), true);
check("по части суммы-части не ищет", matchesOrderSearch({ ...mixedRow, amount: 999_999 }, "6000"), false);

// --- Деньги: реализация не долг, платежи видны в строке -------------------

async function main() {
  const NOW = new Date("2026-09-14T12:00:00");
  const mk = (orderId: string, direction: string, paid: number) => ({
    orderId,
    createdAt: "2026-09-01",
    managerEmail: "m1@x.kz",
    clientName: orderId === "FIRE" ? "Пожарка" : "Салон",
    clientPhone: "",
    deliveryDate: "2026-09-02",
    status: "shipped",
    notes: "",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: false,
    paidAt: "",
    paymentMethod: "Наличные",
    accountantEmail: "",
    paidAmount: paid,
    paidRoseFarm: 0,
    paidEsentai: 0,
    promisedAt: "",
    collectionNote: "",
    clientId: "C1",
    retail: "",
    direction,
    kind: "",
    invoiceSentAt: "",
    invoiceNote: "",
    realization1c: orderId === "FIRE" ? "РН-7" : "",
    totalAmount: 100_000,
    items: [
      {
        orderId,
        itemId: `${orderId}-1`,
        flowerType: "rose",
        variety: "Prestige",
        grade: "60",
        quantity: 100,
        unitPrice: 1000,
        shippedQuantity: 100,
      },
    ],
  });
  const snap = await getFinanceSnapshot("month", "2026-09-14", NOW, {
    orders: [mk("FIRE", "Пожарка", 30_000), mk("SALE", "", 30_000)] as never,
    users: [{ email: "m1@x.kz", name: "Айгерим", role: "manager", farm: null, active: true }] as never,
    payments: [
      {
        paymentId: "PAY-1",
        createdAt: "2026-09-10T10:00:00Z",
        orderId: "FIRE",
        date: "2026-09-09",
        amount: 30_000,
        farm: "",
        method: "Наличные",
        accountantEmail: "buh@x.kz",
        note: "",
      },
    ],
  });
  const row = (id: string) => snap.orders.find((r) => r.orderId === id)!;
  check("пожарка не в долгах", row("FIRE").debt, 0);
  check("остаток на реализации виден", row("FIRE").onConsignment, 70_000);
  check("обычная продажа — долг как был", row("SALE").debt, 70_000);
  check("в долгах по клиентам только обычная продажа", snap.debtTotal, 70_000);
  check("в звонках пожарки нет", snap.calls.map((c) => c.orderId), ["SALE"]);
  check("«ждём оплату» без реализации", snap.totals.unpaidAmount, 70_000);
  check("платёж виден в строке заявки", row("FIRE").payments.map((p) => p.amount), [30_000]);
  check("и день внесения при нём", row("FIRE").payments[0].enteredOn, "2026-09-10");
  check("номер 1С в строке", row("FIRE").realization1c, "РН-7");
  check("сумма по цветку в строке", row("FIRE").byFlower, [{ flowerType: "rose", label: "роза", amount: 100_000 }]);

  console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
