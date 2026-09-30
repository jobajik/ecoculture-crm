/*
 * Три помощника через WhatsApp (сентябрь 2026):
 *   - заказ из WhatsApp → черновик заявки (`waOrder.ts`);
 *   - напоминания о долгах со счётом Kaspi (`debtReminder.ts`);
 *   - утренняя сводка владельцу (`morningDigest.ts`).
 *
 * Запуск: npx tsx scripts/check-wa-automation.ts
 */
import {
  clientForPhone,
  draftFormItems,
  draftSummary,
  looksLikeOrder,
  parseWaOrder,
  visibleDrafts,
  type WaOrderDraft,
} from "../src/lib/waOrder";
import { dueDateOf, planReminders, reminderText, termDays } from "../src/lib/debtReminder";
import { digestNumbers, digestPhones, digestText, salesByFarm } from "../src/lib/morningDigest";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

// --- Заказ из WhatsApp ----------------------------------------------------------
check("заказ похож на заказ", looksLikeOrder("Здравствуйте, 60 роз по 60 см на завтра"), true);
check("хризантема 100 шт", looksLikeOrder("хризантему балтику 100шт"), true);
check("спасибо — не заказ", looksLikeOrder("Спасибо, получили!"), false);
check("без цифр — не зовём ИИ", looksLikeOrder("а розы есть?"), false);

const catalog = { rose: ["Red Naomi", "Avalanche"], chrysanthemum: ["Baltica"], eustoma: ["Rosita"] };
const parsed = parseWaOrder(
  {
    isOrder: true,
    items: [
      { flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 60 },
      { flowerType: "rose", variety: "Выдуманный", grade: "65", quantity: 20 },
      { flowerType: "tulip", variety: "", grade: "", quantity: 10 },
      { flowerType: "chrysanthemum", variety: "Baltica", grade: "Первая", quantity: 0 },
    ],
    deliveryDate: "2026-10-01",
    note: "упаковать в крафт",
  },
  catalog,
  "2026-09-30"
);
check(
  "разбор: чужой цветок и ноль выброшены, выдуманный сорт и длина — пусто",
  parsed?.items,
  [
    { flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 60 },
    { flowerType: "rose", variety: "", grade: "", quantity: 20 },
  ]
);
check("разбор: дата и заметка", [parsed?.deliveryDate, parsed?.note], ["2026-10-01", "упаковать в крафт"]);
check("не заказ — ничего", parseWaOrder({ isOrder: false, items: [], deliveryDate: "", note: "" }, catalog, "2026-09-30"), null);
check(
  "дата в прошлом — пусто",
  parseWaOrder({ isOrder: true, items: [{ flowerType: "rose", variety: "", grade: "60", quantity: 5 }], deliveryDate: "2026-09-01", note: "" }, catalog, "2026-09-30")?.deliveryDate,
  ""
);

const clients = [
  { clientId: "C1", name: "Магнолия", phone: "+7 701 111 22 33", managerEmail: "emil@x", active: true },
  { clientId: "C2", name: "Лилия", phone: "8 702 000 00 00", kaspiPay1: "87770001122", managerEmail: "ilyas@x", active: true },
];
check("клиент по телефону", clientForPhone(clients, "77011112233")?.clientId, "C1");
check("клиент по Kaspi-номеру", clientForPhone(clients, "77770001122")?.clientId, "C2");
const draft = (id: string, phone: string, status = "new"): WaOrderDraft => ({
  draftId: id,
  createdAt: `2026-09-30T0${id.length}:00:00.000Z`,
  phone,
  senderName: "",
  messageId: id,
  text: "",
  items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 60 }],
  deliveryDate: "",
  note: "",
  status,
  orderId: "",
  handledByEmail: "",
  handledAt: "",
});
const drafts = [draft("D1", "77011112233"), draft("D2", "77770001122"), draft("D3", "77059998877"), draft("D4", "77011112233", "done")];
const ids = (xs: { draft: WaOrderDraft }[]) => xs.map((x) => x.draft.draftId).sort();
check("менеджер видит своих и неизвестных", ids(visibleDrafts(drafts, clients, "manager", "emil@x")), ["D1", "D3"]);
check("админ видит все новые", ids(visibleDrafts(drafts, clients, "admin", "a@x")), ["D1", "D2", "D3"]);
check("РОП и бухгалтер — ничего", [visibleDrafts(drafts, clients, "sales_head", "r@x").length, visibleDrafts(drafts, clients, "accountant", "b@x").length], [0, 0]);
check(
  "форма: цена из прайса, у пустой длины цены нет",
  draftFormItems({ items: [...parsed!.items] }, { "rose|Red Naomi|60": 300 }),
  [
    { flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: "60", unitPrice: "300" },
    { flowerType: "rose", variety: "", grade: "", quantity: "20", unitPrice: "" },
  ]
);
check(
  "форма: без сорта — общая цена по длине; сорта нет в справочнике — пусто; единственный — сам",
  draftFormItems(
    {
      items: [
        { flowerType: "rose", variety: "", grade: "60", quantity: 10 },
        { flowerType: "rose", variety: "Старый", grade: "60", quantity: 5 },
        { flowerType: "eustoma", variety: "", grade: "Стандарт", quantity: 7 },
      ],
    },
    { "rose||60": 250 },
    catalog
  ).map((i) => [i.variety, i.unitPrice]),
  [["", "250"], ["", "250"], ["Rosita", ""]]
);
check("кратко", draftSummary(parsed!.items), "Роза Red Naomi 60 · 60 шт.; Роза · 20 шт.");

// --- Напоминания о долгах -------------------------------------------------------
check("отсрочка из условий", [termDays("Отсрочка 7 дней"), termDays("По факту"), termDays(""), termDays("Отсрочка 14 дней")], [7, 0, 0, 14]);
check("срок оплаты = доставка + отсрочка", dueDateOf({ deliveryDate: "2026-09-25", createdAt: "", clientPaymentTerms: "Отсрочка 3 дня" }), "2026-09-28");

const item = (flowerType: string, quantity: number, unitPrice: number) => ({
  itemId: `${flowerType}${quantity}`,
  orderId: "",
  flowerType,
  variety: "x",
  grade: "60",
  quantity,
  unitPrice,
  shippedQuantity: quantity,
});
const o = (orderId: string, clientId: string, extra: Record<string, unknown>) =>
  ({
    orderId,
    clientId,
    clientName: clientId,
    clientPhone: "",
    status: "shipped",
    deliveryDate: "2026-09-20",
    createdAt: "2026-09-19T10:00:00.000Z",
    items: [item("chrysanthemum", 100, 300)],
    paidAmount: 0,
    paidRoseFarm: 0,
    paidEsentai: 0,
    totalAmount: 30000,
    promisedAt: "",
    retail: "",
    kind: "",
    direction: "",
    clientPaymentTerms: "Отсрочка 7 дней",
    managerEmail: "emil@x",
    ...extra,
  }) as never;
const rClients = [
  { clientId: "A", name: "ИП Айгерим", contactPerson: "Айгерим", phone: "87011112233", kaspiPay1: "87011112233" },
  { clientId: "B", name: "Роза-Люкс", phone: "87022223344" },
  { clientId: "C", name: "Городской", phone: "87272000000" },
  { clientId: "D", name: "Обещал", phone: "87033334455" },
  { clientId: "E", name: "Напоминали", phone: "87044445566" },
];
const orders = [
  o("A1", "A", {}), // срок 27.09 — пора; хризантема → счёт Kaspi
  o("A2", "A", { deliveryDate: "2026-09-22", items: [item("rose", 50, 400)], totalAmount: 20000 }), // роза — без Kaspi
  o("B1", "B", { deliveryDate: "2026-09-28" }), // срок 05.10 — рано
  o("C1", "C", {}), // городской номер — показать с проблемой
  o("D1", "D", { promisedAt: "2026-10-02" }), // обещал позже
  o("E1", "E", {}), // напоминали вчера
  o("F1", "A", { direction: "Пожарка" }), // точка на базаре — не долг
  o("G1", "A", { paidAmount: 30000, paidEsentai: 30000 }), // оплачено
];
const plan = planReminders({
  orders,
  clients: rClients,
  reminders: [{ reminderId: "R1", sentAt: "2026-09-29T05:00:00.000Z", phone: "", clientName: "", orderIds: ["E1"], amount: 0, messageId: "m1", kaspiInvoices: "", sentByEmail: "", error: "" }],
  invoices: [],
  kaspiFarms: ["esentai"],
  today: "2026-09-30",
});
check("кому пора: A (две заявки) и C", plan.due.map((g) => [g.key, g.orders.map((x) => x.orderId)]), [["A", ["A1", "A2"]], ["C", ["C1"]]]);
check("пропущены: обещал и напоминали", [plan.promised, plan.recentlyReminded], [1, 1]);
const a = plan.due.find((g) => g.key === "A")!;
check("A: сумма, WhatsApp, Kaspi только по хризантеме", [a.total, a.waPhone, a.kaspiPhone, a.kaspiNew], [50000, "77011112233", "87011112233", [{ orderId: "A1", farm: "esentai", amount: 30000 }]]);
check("C: городской номер — не отправить", plan.due.find((g) => g.key === "C")?.problem, "нет мобильного номера — позвоните");
const text = reminderText(a, a.kaspiNew).replace(/[\u00a0\u202f]/g, " ");
check("текст: обращение по имени", text.startsWith("Здравствуйте, Айгерим!"), true);
check("текст: обе заявки и итог", [text.includes("20.09"), text.includes("22.09"), text.includes("Итого: 50 000 ₸")], [true, true, true]);
check("текст: счёт Kaspi и «остальное удобным способом»", [text.includes("Счёт Kaspi на 30 000 ₸"), text.includes("Остальное")], [true, true]);
const open = planReminders({
  orders: [o("A1", "A", {})],
  clients: rClients,
  reminders: [],
  invoices: [{ orderId: "A1", farm: "esentai", status: "pending", amount: 30000 }],
  kaspiFarms: ["esentai"],
  today: "2026-09-30",
}).due[0];
check("счёт уже выставлен — второй не выставляем", [open.kaspiNew.length, open.kaspiOpen.length], [0, 1]);
const failed = planReminders({
  orders: [o("E1", "E", {})],
  clients: rClients,
  reminders: [{ reminderId: "R2", sentAt: "2026-09-30T04:00:00.000Z", phone: "", clientName: "", orderIds: ["E1"], amount: 0, messageId: "", kaspiInvoices: "", sentByEmail: "", error: "Green API отказал" }],
  invoices: [],
  kaspiFarms: [],
  today: "2026-09-30",
});
check("неушедшее напоминание не считается — снова в списке", failed.due.length, 1);

// --- Утренняя сводка ---------------------------------------------------------------
check("номера сводки", digestPhones("+7 701 111 22 33, 87011112233\n+7 702 000 00 00"), ["+7 701 111 22 33", "87011112233", "+7 702 000 00 00"]);
const dOrders = [
  { orderId: "S1", createdAt: "2026-09-29T06:00:00.000Z", deliveryDate: "2026-09-30", status: "new", managerEmail: "emil@x", totalAmount: 100000, paidAmount: 0, items: [{ quantity: 200, shippedQuantity: 0 }] },
  { orderId: "S2", createdAt: "2026-09-29T07:00:00.000Z", deliveryDate: "2026-09-30", status: "new", managerEmail: "ilyas@x", totalAmount: 50000, paidAmount: 50000, items: [{ quantity: 100, shippedQuantity: 40 }] },
  { orderId: "S3", createdAt: "2026-09-29T08:00:00.000Z", deliveryDate: "2026-09-29", status: "shipped", managerEmail: "emil@x", totalAmount: 70000, paidAmount: 0, items: [{ quantity: 10, shippedQuantity: 10 }], direction: "Пожарка" },
  { orderId: "S4", createdAt: "2026-09-20T07:00:00.000Z", deliveryDate: "2026-09-21", status: "shipped", managerEmail: "emil@x", totalAmount: 40000, paidAmount: 10000, items: [{ quantity: 10, shippedQuantity: 10 }] },
  { orderId: "S5", createdAt: "2026-09-29T09:00:00.000Z", deliveryDate: "2026-09-30", status: "cancelled", managerEmail: "emil@x", totalAmount: 99000, paidAmount: 0, items: [{ quantity: 10, shippedQuantity: 0 }] },
];
const dInput = {
  today: "2026-09-30",
  orders: dOrders,
  payments: [{ date: "2026-09-29", amount: 50000 }, { date: "2026-09-28", amount: 7000 }],
  pointDays: [{ date: "2026-09-29", kaspi: 30000, cash: 12000 }],
  attention: [{ label: "Опаздывают с отгрузкой: 2 заявок", detail: "300 шт.", href: "", tone: "critical" as const }],
  names: { "emil@x": "Эмиль", "ilyas@x": "Ильяс" },
  dayOf: (iso: string) => iso.slice(0, 10),
  site: "https://www.crm-ecoculture.kz",
};
const nums = digestNumbers(dInput);
check("вчера: продажи без точки и отменённой", [nums.sales.count, nums.sales.amount], [2, 150000]);
check("вчера: по менеджерам", nums.sales.byManager.map((m) => m.name), ["Эмиль", "Ильяс"]);
check("вчера: деньги и точка", [nums.money, nums.point], [50000, 42000]);
check("сегодня к отгрузке: без отменённой, остаток стеблей", nums.today, { count: 2, stems: 260 });
check("долги без точки, просрочка по доставке", [nums.debt, nums.overdue], [130000, 30000]);
const dText = digestText(dInput);
check("текст сводки: заголовок, внимание, ссылка", [dText.includes("на 30.09"), dText.includes("Опаздывают"), dText.endsWith("crm-ecoculture.kz")], [true, true, true]);

// Продажи по компаниям: Ильяс, Эмиль, Бауыржан и Пожарка — всегда; остальные — если продавали.
const fOrders = [
  { orderId: "F1", createdAt: "2026-09-29T06:00:00.000Z", deliveryDate: "2026-09-30", status: "new", managerEmail: "ilyas@x", totalAmount: 0, paidAmount: 0,
    items: [{ quantity: 100, shippedQuantity: 0, flowerType: "rose", unitPrice: 200 }, { quantity: 50, shippedQuantity: 0, flowerType: "chrysanthemum", unitPrice: 300 }] },
  { orderId: "F2", createdAt: "2026-09-29T07:00:00.000Z", deliveryDate: "2026-09-30", status: "new", managerEmail: "sayat@x", totalAmount: 0, paidAmount: 0,
    items: [{ quantity: 10, shippedQuantity: 0, flowerType: "eustoma", unitPrice: 500 }] },
  { orderId: "F3", createdAt: "2026-09-29T08:00:00.000Z", deliveryDate: "2026-09-29", status: "shipped", managerEmail: "emil@x", totalAmount: 0, paidAmount: 0, direction: "Пожарка",
    items: [{ quantity: 200, shippedQuantity: 200, flowerType: "chrysanthemum", unitPrice: 250 }] },
  { orderId: "F4", createdAt: "2026-09-29T08:00:00.000Z", deliveryDate: "2026-09-29", status: "new", managerEmail: "emil@x", totalAmount: 0, paidAmount: 0, retail: "almaty",
    items: [{ quantity: 99, shippedQuantity: 0, flowerType: "rose", unitPrice: 100 }] },
];
const fInput = { ...dInput, orders: fOrders, names: { "ilyas@x": "Ильяс Иванов", "emil@x": "Эмиль Нурланов", "sayat@x": "Саят", "baur@x": "Бауыржан К." } };
const farms = salesByFarm(fInput, "2026-09-29");
const show = (f: (typeof farms)[number]) => f.rows.map((r) => `${r.name}:${r.amount}/${r.stems}`);
check("Rose Farm: всегда трое и Пожарка, Саят — потому что продавал, магазин не в счёт", show(farms[0]), ["Ильяс:20000/100", "Эмиль:0/0", "Бауыржан:0/0", "Саят:5000/10", "Пожарка:0/0"]);
check("Есентай: Пожарка отдельной строкой, Саята нет", show(farms[1]), ["Ильяс:15000/50", "Эмиль:0/0", "Бауыржан:0/0", "Пожарка:50000/200"]);
check("итог компании", [farms[0].amount, farms[1].stems], [25000, 250]);
const sText = digestText({ ...fInput, stock: [{ flowerType: "rose", stems: 5000, expired: 300 }, { flowerType: "chrysanthemum", stems: 8000, expired: 0 }] }).replace(/[\u00a0\u202f]/g, " ");
check(
  "текст: блоки компаний и склада",
  [sText.includes("*Rose Farm:*"), sText.includes("• Пожарка: 50 000 ₸ · 200 шт."), sText.includes("*Склад сейчас:*"), sText.includes("роза 5 000 шт. (дольше срока 300)")],
  [true, true, true, true]
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
