/**
 * «Мой день» менеджера: ждёт ответа считается от первого сообщения серии клиента и сортируется по давности,
 * чужие и городские заявки в «где нужен я» не попадают, просроченное касание помечено и идёт первым, темп месяца
 * красит полоску, заказы помощника считаются за сутки по своему менеджеру.
 */
import { assistantDigest, buildManagerDay, managerLeads, managerOrders, monthProgress, waitingChats, type DayOrderInput } from "../src/lib/myDay/manager";
import type { ChatSummary } from "../src/lib/waLines";
import type { LeadRow } from "../src/lib/leads";
import type { AssistantLogRow } from "../src/lib/repo/waLines";
import type { LeaderboardRow } from "../src/lib/leaderboard";
import { ASSISTANT_ORDER_MARK } from "../src/lib/sellerChannel";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-10-19";
const NOW = new Date("2026-10-19T09:00:00+05:00");
const fmt = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

// --- Ждут ответа ------------------------------------------------------------------
const chat = (p: Partial<ChatSummary> & { phone: string }): ChatSummary => ({
  line: "m-ilyas@x.kz", key: p.phone, name: p.phone, party: null, lastAt: ago(1), lastText: "…", lastDirection: "in",
  lastByAssistant: false, waitingSince: null, count: 3, ...p,
});
const chats = [
  chat({ phone: "77010000001", name: "Магнолия", waitingSince: ago(42), party: { kind: "client", id: "C1", name: "Магнолия", managerEmail: "ilyas@x.kz" } }),
  chat({ phone: "77010000002", name: "Флора Маркет", waitingSince: ago(80) }),
  chat({ phone: "77010000003", name: "Ответили", waitingSince: null, lastDirection: "out" }),
];
const w = waitingChats(chats, NOW);
check("ждут ответа — только с waitingSince", w.total, 2);
check("дольше ждущий — первым", w.rows.map((r) => r.name), ["Флора Маркет", "Магнолия"]);
check("дольше часа — красным", w.rows.map((r) => r.long), [true, false]);
check("кто это", w.rows.map((r) => r.who), ["новый номер", "клиент"]);
check("ссылка ведёт в переписку номера", w.rows[1].href, "/clients/chats?line=m-ilyas%40x.kz&phone=77010000001");

// --- Заявки, где нужен я ------------------------------------------------------------
const order = (p: Partial<DayOrderInput> & { orderId: string }): DayOrderInput => ({
  managerEmail: "ilyas@x.kz", status: "new", deliveryDate: "2026-10-20", createdAt: "2026-10-18T10:00:00", managerConfirmed: false,
  paid: false, paidAmount: 0, totalAmount: 100_000, clientName: "Цветы 24",
  items: [{ variety: "Jumilia", grade: "60", quantity: 800, shippedQuantity: 0 }], ...p,
});
const orders = [
  order({ orderId: "ORD-1-AAAAA" }),
  order({ orderId: "ORD-1-BBBBB", deliveryDate: "", createdAt: "2026-10-17T10:00:00" }),
  order({ orderId: "ORD-1-CCCCC", managerConfirmed: true, paid: true, paidAmount: 100_000 }),
  order({ orderId: "ORD-1-DDDDD", managerEmail: "emil@x.kz" }),
  order({ orderId: "ORD-1-EEEEE", kind: "region", direction: "Астана" }),
  order({ orderId: "ORD-1-FFFFF", status: "cancelled" }),
  order({ orderId: "ORD-1-GGGGG", status: "shipped", items: [{ variety: "Jumilia", grade: "60", quantity: 800, shippedQuantity: 800 }] }),
];
const mo = managerOrders(orders, "Ilyas@x.kz", TODAY, fmt);
check("ждут галочки — свои неподтверждённые, без чужих, городских, отменённых", mo.waitingMe.rows.map((r) => r.code), ["AAAAA", "BBBBB"]);
check("без даты — отдельно", mo.noDate.rows.map((r) => r.code), ["BBBBB"]);
check("открытых своих", mo.open, 3);
check("доставка словами", mo.waitingMe.rows.map((r) => r.deliveryLabel), ["завтра", "без даты"]);
check("позиции строкой", mo.waitingMe.rows[0].itemsLabel, "Jumilia 60 — 800");

// --- Касания --------------------------------------------------------------------------
const lead = (p: Partial<LeadRow> & { leadId: string }): LeadRow =>
  ({ name: "Лид", city: "Семей", phone: "7701", stage: "contact", managerEmail: "ilyas@x.kz", nextTouchAt: TODAY, overdue: false, dueToday: true, lastComment: "", touches: 1, ...p }) as LeadRow;
const leads = [
  lead({ leadId: "L1", name: "Сегодня" }),
  lead({ leadId: "L2", name: "Просрочен", nextTouchAt: "2026-10-17", overdue: true, dueToday: false }),
  lead({ leadId: "L3", name: "Чужой", managerEmail: "emil@x.kz" }),
  lead({ leadId: "L4", name: "Завтра", nextTouchAt: "2026-10-20", dueToday: false }),
  lead({ leadId: "L5", name: "Закрыт", stage: "lost", overdue: true, dueToday: false, nextTouchAt: "2026-10-01" }),
];
const ml = managerLeads(leads, "ilyas@x.kz", TODAY, fmt);
check("касания: просроченный первым, чужой и закрытый не в счёт", ml.rows.map((r) => r.name), ["Просрочен", "Сегодня"]);
check("просрочка словами", ml.rows.map((r) => r.when), ["просрочено 2 дн.", "сегодня"]);

// --- Месяц ----------------------------------------------------------------------------
const row = (p: Partial<LeaderboardRow>): LeaderboardRow => ({ totalAmount: 4_100_000, targetAmount: 6_000_000, bonus: 61_500, pendingBonus: 18_200, orders: 37, ...p }) as LeaderboardRow;
const m = monthProgress(row({}), TODAY);
check("темп месяца 19 октября", Math.round(m.pacePercent), 61);
check("68 % выше темпа — зелёный", [Math.round(m.percent ?? 0), m.tone], [68, "good"]);
check("отстаёт на 10 п.п. — жёлтый", monthProgress(row({ totalAmount: 3_100_000 }), TODAY).tone, "warn");
check("отстаёт на 30 п.п. — красный", monthProgress(row({ totalAmount: 1_900_000 }), TODAY).tone, "bad");
check("без плана — серый, процента нет", [monthProgress(row({ targetAmount: 0 }), TODAY).tone, monthProgress(row({ targetAmount: 0 }), TODAY).percent], ["muted", null]);
check("без строки рейтинга — нули", monthProgress(undefined, TODAY).sold, 0);

// --- ИИ-помощник ----------------------------------------------------------------------
const logRow = (p: Partial<AssistantLogRow>): AssistantLogRow => ({ logId: "", at: ago(60), line: "m-ilyas@x.kz", phone: "7701", kind: "auto", messageId: "m1", text: "", note: "", byEmail: "", doneAt: "", rowNumber: 1, ...p });
const log = [
  logRow({}),
  logRow({ kind: "nudge", messageId: "m2" }),
  logRow({ kind: "auto", messageId: "m3", at: ago(30 * 60) }),
  logRow({ kind: "note", messageId: "", note: "отсрочка" }),
  logRow({ kind: "note", messageId: "", note: "сделано", doneAt: ago(10) }),
  logRow({ kind: "auto", messageId: "m4", line: "m-emil@x.kz" }),
];
const aiOrders = [
  order({ orderId: "ORD-1-R7T2C", notes: `Заказ. ${ASSISTANT_ORDER_MARK}`, createdAt: ago(300), totalAmount: 60_000, clientName: "Магнолия" }),
  order({ orderId: "ORD-1-OLD11", notes: ASSISTANT_ORDER_MARK, createdAt: ago(3000) }),
  order({ orderId: "ORD-1-HUMAN", createdAt: ago(300) }),
];
const since = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
const ai = assistantDigest(log, aiOrders, ["m-ilyas@x.kz"], "ilyas@x.kz", since);
check("ответов за сутки — свои линии, auto и nudge, без старых", ai.replies, 2);
check("открытых записок", ai.openNotes, 1);
check("заказ помощника за сутки", ai.orders.map((o) => o.code), ["R7T2C"]);
check("без номера — hasLine false", assistantDigest(log, aiOrders, [], "ilyas@x.kz", since).hasLine, false);

// --- Сводка ---------------------------------------------------------------------------
const day = buildManagerDay({ email: "ilyas@x.kz", today: TODAY, now: NOW, chats, orders, leads, leaderboard: row({}), assistantLog: log, lineCodes: ["m-ilyas@x.kz"], formatDay: fmt });
check("строка-сводка", day.summary, "2 клиента ждут ответа · 2 заявки ждут вашей галочки · 1 без даты доставки · 2 касания на сегодня");
check("пустой день — словами", buildManagerDay({ email: "x@x.kz", today: TODAY, now: NOW, chats: [], orders: [], leads: [], assistantLog: [], lineCodes: [], formatDay: fmt }).summary, "Никто не ждёт — можно продавать.");

if (fails > 0) {
  console.log(`\nПровалено проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
