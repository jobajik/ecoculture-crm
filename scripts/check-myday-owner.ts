/**
 * «Мой день» владельца и РОПа (`src/lib/myDay/owner.ts`).
 *
 * Проверяем счёт, а не вид: вчерашние продажи — по дню оформления по Алматы и без не-продаж; деньги за неделю — по
 * дню поступления и по компаниям; цвет менеджера — относительно темпа месяца; «ждут ответа» — только чаты номеров
 * менеджеров, где последним писал клиент и не старше трёх дней; ИИ за сутки — только свежие строки; к отгрузке
 * сегодня — по складам, только готовые.
 */
import { buildOwnerDay, managerTone, waitingChatsByLine, type OwnerDayInput } from "../src/lib/myDay/owner";
import type { OrderWithItems, Payment, WaMessage } from "../src/lib/types";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-10-19";
const NOW = Date.parse("2026-10-19T09:00:00+05:00");
const toDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });

const order = (p: Partial<OrderWithItems> & { orderId: string }): OrderWithItems =>
  ({
    createdAt: "2026-10-01T10:00:00+05:00", managerEmail: "ilyas@x.kz", clientName: "Цветы 24", clientPhone: "", deliveryDate: "2026-10-25",
    status: "new", notes: "", managerConfirmed: true, paid: true, paidAmount: 100_000, totalAmount: 100_000, retail: "", kind: "", direction: "",
    store: "", items: [{ flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 500, shippedQuantity: 0, unitPrice: 200 }],
    ...p,
  }) as unknown as OrderWithItems;
const payment = (p: Partial<Payment> & { paymentId: string }): Payment =>
  ({ orderId: "x", createdAt: "", date: TODAY, amount: 1000, farm: "rose_farm", method: "Каспи", accountantEmail: "", note: "", ...p }) as Payment;
const msg = (p: Partial<WaMessage> & { messageId: string }): WaMessage =>
  ({ at: "2026-10-19T08:00:00+05:00", chatId: "", phone: "77010000001", direction: "in", type: "text", text: "", mediaUrl: "", senderName: "", source: "webhook", line: "m-ilyas", ...p }) as WaMessage;

const orders = [
  // Вчера по Алматы: 18.10 23:30 по Алматы — это 18.10 (в UTC было бы 18:30, тоже 18-е; берём граничный случай ниже).
  order({ orderId: "A", createdAt: "2026-10-18T23:30:00+05:00", totalAmount: 150_000 }),
  // 19.10 02:00 по Алматы = 18.10 21:00 UTC: это уже СЕГОДНЯ, не вчера.
  order({ orderId: "B", createdAt: "2026-10-19T02:00:00+05:00", totalAmount: 999_000 }),
  // Отменённая и перемещение в наш магазин — не продажи.
  order({ orderId: "C", createdAt: "2026-10-18T12:00:00+05:00", status: "cancelled", totalAmount: 50_000 }),
  order({ orderId: "D", createdAt: "2026-10-18T12:00:00+05:00", retail: "almaty", totalAmount: 50_000 }),
  // К отгрузке сегодня: готова, роза; офисная заявка; хризантема; неготовая (не подтверждена) — нет; завтра — нет.
  order({ orderId: "E", deliveryDate: TODAY }),
  order({ orderId: "F", deliveryDate: TODAY, store: "office", items: [{ flowerType: "rose", variety: "J", grade: "60", quantity: 200, shippedQuantity: 50, unitPrice: 200 }] as never }),
  order({ orderId: "G", deliveryDate: TODAY, items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantity: 300, shippedQuantity: 0, unitPrice: 200 }] as never }),
  order({ orderId: "H", deliveryDate: TODAY, managerConfirmed: false }),
  order({ orderId: "I", deliveryDate: "2026-10-20" }),
  // ИИ за сутки: заказ бота и заказ помощника Ильяса (свежие), старый заказ бота — нет.
  order({ orderId: "J", createdAt: "2026-10-19T07:00:00+05:00", managerEmail: "bot@ecoculture.kz" }),
  order({ orderId: "K", createdAt: "2026-10-19T07:30:00+05:00", notes: "Заказ оформил ИИ-помощник Ильяса в WhatsApp." }),
  order({ orderId: "L", createdAt: "2026-10-10T07:00:00+05:00", managerEmail: "bot@ecoculture.kz" }),
];

const input: OwnerDayInput = {
  today: TODAY,
  month: "2026-10",
  pacePercent: 61,
  orders,
  managers: [
    { managerEmail: "ilyas@x.kz", name: "ilyas@x.kz", amountMonth: 4_100_000, targetAmount: 6_000_000, ordersMonth: 37 } as never,
    { managerEmail: "emil@x.kz", name: "Эмиль", amountMonth: 3_000_000, targetAmount: 6_000_000, ordersMonth: 31 } as never,
    { managerEmail: "ilgar@x.kz", name: "Ильгар", amountMonth: 2_000_000, targetAmount: 5_000_000, ordersMonth: 24 } as never,
    { managerEmail: "bot@ecoculture.kz", name: "Бот WhatsApp", amountMonth: 800_000, targetAmount: 0, ordersMonth: 9 } as never,
  ],
  totals: { amountMonth: 18_400_000, targetAmount: 26_000_000 },
  payments: [
    payment({ paymentId: "p1", date: "2026-10-18", amount: 200_000 }),
    payment({ paymentId: "p2", date: "2026-10-18", amount: 100_000, farm: "esentai" }),
    payment({ paymentId: "p3", date: "2026-10-13", amount: 50_000 }),
    // Ровно неделю назад (12.10) — уже не в «за неделю» (семь дней: 13–19).
    payment({ paymentId: "p4", date: "2026-10-12", amount: 1_000_000 }),
    payment({ paymentId: "p5", date: TODAY, amount: 10_000, farm: "" }),
  ],
  debts: { total: 3_800_000, overdue: 1_100_000, overdueOrders: 9, openOrders: 41 },
  stock: {
    overall: { farm: "", stems: 128_000, batches: 0, varieties: 0, avgAgeDays: 0, warningStems: 10_000, criticalStems: 10_240, value: null, criticalValue: null, unpricedStems: 0, liquidPercent: null } as never,
    companies: [
      { farm: "rose_farm", stems: 72_000, warningStems: 8_640, criticalStems: 2_160 } as never,
      { farm: "esentai", stems: 56_000, warningStems: 14_000, criticalStems: 8_400 } as never,
    ],
  },
  push: [{ text: "Altaj Четвёртая — 44 000 шт.", sold7: 5200 }],
  attention: [{ label: "a", detail: "", href: "/", tone: "warn" }, { label: "b", detail: "", href: "/", tone: "critical" }],
  managerLines: [{ code: "m-ilyas", managerEmail: "ilyas@x.kz" }, { code: "m-emil", managerEmail: "emil@x.kz" }],
  messages: [
    // Ильяс: клиент написал последним — ждёт.
    msg({ messageId: "1", phone: "77010000001", at: "2026-10-19T08:00:00+05:00" }),
    // Ильяс: клиент написал, Ильяс ответил — не ждёт.
    msg({ messageId: "2", phone: "77010000002", at: "2026-10-19T07:00:00+05:00" }),
    msg({ messageId: "3", phone: "77010000002", at: "2026-10-19T07:10:00+05:00", direction: "out" }),
    // Ильяс: клиент писал пять дней назад — разговор закончен.
    msg({ messageId: "4", phone: "77010000003", at: "2026-10-14T07:00:00+05:00" }),
    // Эмиль: ждёт один.
    msg({ messageId: "5", phone: "77010000004", line: "m-emil" }),
    // Основной номер: входящие от двух номеров за сутки, один старый; одному из них ушла рассылка — «ответил».
    msg({ messageId: "6", phone: "77050000001", line: "" }),
    msg({ messageId: "7", phone: "77050000002", line: "" }),
    msg({ messageId: "8", phone: "77050000003", line: "", at: "2026-10-15T08:00:00+05:00" }),
  ],
  assistantLog: [
    { logId: "1", at: "2026-10-19T03:00:00+05:00", line: "m-ilyas", phone: "", kind: "auto", messageId: "", text: "", note: "", byEmail: "", doneAt: "", rowNumber: 2 },
    { logId: "2", at: "2026-10-19T03:10:00+05:00", line: "m-ilyas", phone: "", kind: "nudge", messageId: "", text: "", note: "", byEmail: "", doneAt: "", rowNumber: 3 },
    { logId: "3", at: "2026-10-19T03:20:00+05:00", line: "m-ilyas", phone: "", kind: "note", messageId: "", text: "", note: "", byEmail: "", doneAt: "", rowNumber: 4 },
    { logId: "4", at: "2026-10-01T03:20:00+05:00", line: "m-ilyas", phone: "", kind: "note", messageId: "", text: "", note: "", byEmail: "", doneAt: "", rowNumber: 5 },
    { logId: "5", at: "2026-10-01T03:20:00+05:00", line: "m-ilyas", phone: "", kind: "note", messageId: "", text: "", note: "", byEmail: "", doneAt: "2026-10-02", rowNumber: 6 },
    { logId: "6", at: "2026-10-10T03:00:00+05:00", line: "m-ilyas", phone: "", kind: "auto", messageId: "", text: "", note: "", byEmail: "", doneAt: "", rowNumber: 7 },
  ],
  recipients: [
    { broadcastId: "b", phone: "77050000001", name: "", kind: "client", refId: "", managerEmail: "", status: "sent", messageId: "m", sentAt: "2026-10-18T12:00:00+05:00", error: "" },
    { broadcastId: "b", phone: "77050000009", name: "", kind: "client", refId: "", managerEmail: "", status: "sent", messageId: "m", sentAt: "2026-10-18T12:01:00+05:00", error: "" },
    { broadcastId: "b", phone: "77050000008", name: "", kind: "client", refId: "", managerEmail: "", status: "sent", messageId: "m", sentAt: "2026-10-10T12:00:00+05:00", error: "" },
  ],
  leads: [
    { leadId: "1", createdAt: "2026-10-19T06:00:00+05:00", origin: "ads" } as never,
    { leadId: "2", createdAt: "2026-10-19T06:00:00+05:00", origin: "" } as never,
    { leadId: "3", createdAt: "2026-10-01T06:00:00+05:00", origin: "ads" } as never,
  ],
  nameByEmail: new Map([["ilyas@x.kz", "Ильяс"], ["bot@ecoculture.kz", "Бот WhatsApp"]]),
  nowMs: NOW,
  toDay,
};

const day = buildOwnerDay(input);

check("вчера продали — по дню оформления по Алматы, без отменённых и магазинов", day.summary.yesterdayAmount, 150_000);
check("вчера заявок", day.summary.yesterdayOrders, 1);
check("вчера пришло — по дню поступления", day.summary.yesterdayReceived, 300_000);
check("требует внимания — число строк", day.summary.attentionCount, 2);

check("продажи месяца: процент плана", Math.round(day.sales.percent ?? 0), 71);
check("продажи месяца: выше темпа — хорошо", day.sales.tone, "good");
check("темп", managerTone(60, 61), "warn");
check("сильно ниже темпа — плохо", managerTone(40, 61), "bad");
check("без плана — без цвета", managerTone(null, 61), "none");

check("деньги за неделю: 13–19 октября, без 12-го", day.money.week, 360_000);
check("деньги по компаниям", day.money.byFarm, [
  { farm: "rose_farm", label: "Rose Farm", amount: 250_000 },
  { farm: "esentai", label: "Есентай Агро Хим", amount: 100_000 },
  { farm: "", label: "без компании", amount: 10_000 },
]);

check("склад: доля дольше срока", day.stock.criticalShare, 8);
check("склад: распродаём", day.stock.push, "Altaj Четвёртая — 44 000 шт.");
check("компании: доли", day.companies.map((c) => [c.label, c.okShare, c.warnShare, c.badShare]), [
  ["Rose Farm", 85, 12, 3],
  ["Есентай Агро Хим", 60, 25, 15],
]);

check("менеджеры: по убыванию продаж, имя из Users, бот — «Бот и ИИ»", day.managers.map((m) => m.name), ["Ильяс", "Эмиль", "Ильгар", "Бот и ИИ"]);
check("менеджеры: цвет относительно темпа", day.managers.map((m) => m.tone), ["good", "warn", "bad", "none"]);
check("менеджеры: ждут ответа по номеру менеджера", day.managers.map((m) => m.waiting), [1, 1, 0, 0]);
check("ждут ответа по линиям", Array.from(waitingChatsByLine(input.messages, NOW).entries()), [["m-ilyas", 1], ["m-emil", 1]]);

check("ИИ: рассылка — ушло за сутки", day.ai.broadcastSent, 2);
check("ИИ: рассылка — ответили", day.ai.broadcastReplied, 1);
check("ИИ: помощник — ответы и дожим", day.ai.assistantReplies, 2);
check("ИИ: помощник — заказы", day.ai.assistantOrders, 1);
check("ИИ: открытые записки (и старые тоже — они всё ещё ждут)", day.ai.assistantNotes, 2);
check("ИИ: бот — разговоров за сутки", day.ai.botChats, 2);
check("ИИ: бот — заказов за сутки", day.ai.botOrders, 1);
check("ИИ: лиды с рекламы за сутки", day.ai.adsLeads, 1);

check("к отгрузке сегодня — по складам, только готовые, остаток стеблей", day.shipToday, [
  { label: "Rose Farm", orders: 1, stems: 500 },
  { label: "Есентай Агро Хим", orders: 1, stems: 300 },
  { label: "Офис", orders: 1, stems: 150 },
]);

if (fails > 0) {
  console.log(`\nПровалено проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
