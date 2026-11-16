/*
 * Бот и неоплаченные заявки менеджеров (16.11.2026).
 *
 * Клиентка ответила на напоминание об оплате заявки менеджера «не оплатила, выставляйте счёт сегодня, на этот же номер»,
 * а бот основного номера предложил ей новый заказ («выставляю счёт на 200 шт. Altaj, четвёртая категория, 36 000 ₸») и
 * пообещал счёт, которого не выставлял. Проверка стережёт три вещи: бот знает о таких заявках и их счетах; он видит,
 * что мы сами писали клиенту с этого номера мимо него; он не обещает счёт без действия — но правду про уже выставленный
 * счёт говорить может.
 *
 * Запуск: npx tsx scripts/check-bot-debt.ts
 */
import { claimsInvoiceNow, debtContextLines, unpaidManagerOrders } from "../src/lib/botDebt";
import { missingOutgoing, withMissingOutgoing } from "../src/lib/botTurn";
import type { KaspiInvoice, OrderWithItems } from "../src/lib/types";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const now = new Date("2026-11-16T05:12:00.000Z"); // 10:12 по Алматы
const PHONE = "77010001778";
function order(id: string, patch: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    orderId: id, createdAt: "2026-11-14T06:40:00.000Z", managerEmail: "ilgar@x.kz", clientId: "C1", clientName: "Оля", clientPhone: "+7 701 000 17 78",
    deliveryDate: "2026-11-16", status: "new", notes: "", totalAmount: 60000, paidAmount: 0, retail: "", direction: "", kind: "",
    items: [{ orderId: id, itemId: `${id}-I1`, flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 150, unitPrice: 400, shippedQuantity: 0 }],
    ...patch,
  } as unknown as OrderWithItems;
}
function invoice(orderId: string, status: string, createdAt: string, amount = 60000): KaspiInvoice {
  return { invoiceId: `${orderId}-${createdAt}`, createdAt, orderId, farm: "rose_farm", amount, phone: "87010001778", status, kaspiInvoiceId: "", errorCode: "", errorMessage: "" } as unknown as KaspiInvoice;
}
const base = {
  invoices: [invoice("ORD-261114-B5UTR", "expired", "2026-11-14T06:42:00.000Z"), invoice("ORD-261114-B5UTR", "pending", "2026-11-15T16:52:00.000Z")],
  reminders: [{ sentAt: "2026-11-16T05:08:00.000Z", orderIds: ["ORD-261114-B5UTR"], phone: PHONE }],
  clientId: "C1", phone: PHONE, now, managerName: (e: string) => (e === "ilgar@x.kz" ? "Ильгар" : "менеджер"),
};

console.log("— Что бот знает о неоплаченной заявке менеджера —");
const lines = debtContextLines({ ...base, orders: [order("ORD-261114-B5UTR"), order("ORD-261023-A3B28", { createdAt: "2026-10-23T07:43:00.000Z", status: "shipped", paidAmount: 60000 })] });
const text = lines.join("\n").replace(/ | /g, " ");
check("строк: заголовок, заявка, напоминание, правило", lines.length, 4);
check("заявка названа: номер, менеджер, состав, сумма", ["№B5UTR", "менеджер Ильгар", "Altaj Вторая 150 шт. по 400 ₸", "60 000 ₸", "не оплачено 60 000 ₸", "доставка 16.11"].map((x) => text.includes(x)), [true, true, true, true, true, true]);
check("открытый счёт назван — когда и что ждёт оплаты", [text.includes("выставлен 15.11 в 21:52"), text.includes("ЖДЁТ ОПЛАТЫ")], [true, true]);
check("напоминание названо со временем по Алматы", text.includes("16.11 в 10:08 ушло напоминание об оплате"), true);
check("правило: не новый заказ, сам счёт не выставляет", [text.includes("это НЕ новый заказ"), text.includes("Сам такой счёт ты не выставляешь")], [true, true]);
check("оплаченная заявка в список не идёт", text.includes("A3B28"), false);

console.log("\n— Какие заявки сюда попадают —");
const u = (orders: OrderWithItems[], extra = {}) => unpaidManagerOrders({ ...base, orders, ...extra }).map((o) => o.orderId);
check("отменённая — нет", u([order("X1", { status: "cancelled" })]), []);
check("чужого клиента — нет", u([order("X2", { clientId: "C9", clientPhone: "+7 705 999 00 00" })]), []);
check("по телефону, если карточка не записана", u([order("X3", { clientId: "" })]), ["X3"]);
check("заказ самого бота — нет: о нём свой блок", u([order("X4")], { own: new Set(["X4"]) }), []);
check("перемещение в наш магазин — нет", u([order("X5", { retail: "almaty" })]), []);
check("частично оплаченная — да", u([order("X6", { paidAmount: 20000 })]), ["X6"]);
check("старше 60 дней — нет", u([order("X7", { createdAt: "2026-08-01T05:00:00.000Z" })]), []);
check("без неоплаченных заявок — строк нет вовсе", debtContextLines({ ...base, orders: [order("X8", { paidAmount: 60000 })] }), []);
const noInvoice = debtContextLines({ ...base, invoices: [], reminders: [], orders: [order("ORD-1-NOINV")] }).join("\n");
check("счёта не было — так и сказано, напоминания нет", [noInvoice.includes("счёт Kaspi ещё не выставлялся"), noInvoice.includes("ушло напоминание")], [true, false]);
const expired = debtContextLines({ ...base, invoices: [invoice("ORD-1-EXP", "expired", "2026-11-14T06:42:00.000Z")], orders: [order("ORD-1-EXP")] }).join("\n");
check("счёт истёк — сказано, что нового нет", expired.includes("истёк, нового нет"), true);

console.log("\n— Обещание счёта без действия —");
const said = [
  "Всё понял. Сейчас выставляю счёт на 200 шт. хризантемы Altaj, четвёртая категория, 36 000 ₸ на завтра.",
  "Да, счёт Kaspi сейчас придёт на этот номер. Как оплатите - отпишитесь.",
  "Хорошо, сегодня выставлю счёт на этот номер.",
  "Отправляю вам счёт, проверьте Kaspi.",
  "Счёт сегодня выставим, не переживайте.",
];
check("фразы из того разговора и похожие — обещание", said.map(claimsInvoiceNow), [true, true, true, true, true]);
const fine = [
  "Счёт на 60 000 ₸ по заказу №B5UTR уже выставлен вчера в 21:52 на этот номер и ждёт оплаты - проверьте, пожалуйста, Kaspi.",
  "Передал Ильгару - он проверит счёт и напишет вам сюда же.",
  "Вчера вам выставили счёт, он ещё действует.",
  "Altaj, вторая категория - 400 ₸ за стебель. Поставить 150 шт. на завтра, это 60 000 ₸?",
  "После оплаты сразу передадим на сборку.",
];
check("правда про уже выставленный счёт и обычные ответы — не обещание", fine.map(claimsInvoiceNow), [false, false, false, false, false]);

console.log("\n— Наши сообщения с этого номера мимо бота —");
const memory = [
  { role: "us" as const, text: "[фото: Хризантема Altaj] Здравствуйте! Свежая хризантема Altaj, четвёртая категория, 180 ₸ за стебель в наличии. Поставить 200 шт. на завтра, это 36 000 ₸?", at: "2026-11-10T05:34:00.000Z" },
  { role: "client" as const, text: "Здравствуйте. Нет, нет, не оплатила. Давайте сегодня счёт выставляйте, и я сегодня оплачу.", at: "2026-11-16T05:11:00.000Z" },
];
const msg = (direction: string, text: string, at: string, phone = PHONE) => ({ messageId: `${at}-${text.length}`, phone, direction, at, text, type: "text" });
const recent = [
  msg("out", "Здравствуйте, Оля! Напоминаем об оплате за цветы от Ecoculture: • заказ от 16.11 (№ B5UTR) - 60 000 ₸", "2026-11-16T05:08:00.000Z"),
  msg("in", "Здравствуйте. Нет, нет, не оплатила.", "2026-11-16T05:11:00.000Z"),
  msg("out", "Здравствуйте! Свежая хризантема Altaj, четвёртая категория, 180 ₸ за стебель в наличии. Поставить 200 шт. на завтра, это 36 000 ₸?", "2026-11-15T05:34:00.000Z"),
  msg("out", "Чужому клиенту", "2026-11-16T05:00:00.000Z", "77059990000"),
  msg("out", "", "2026-11-16T05:09:00.000Z"),
  msg("out", "Старое сообщение трёхдневной давности", "2026-11-13T04:00:00.000Z"),
];
const missing = missingOutgoing(memory, recent, PHONE, now);
check("в память идёт только напоминание об оплате", missing.map((m) => m.text.slice(0, 30)), ["Здравствуйте, Оля! Напоминаем "]);
const merged = withMissingOutgoing(memory, missing);
check("напоминание встаёт ПЕРЕД ответом клиента", merged.map((c) => `${c.role}:${c.text.slice(0, 12)}`), ["us:[фото: Хриза", "us:Здравствуйте", "client:Здравствуйте"]);
check("повторно то же не добавляется", missingOutgoing(merged, recent, PHONE, now).length, 0);
check("звёздочки выделения не мешают узнать своё", missingOutgoing([{ role: "us", text: "Это 80 000 ₸. Оформляю на этот объём?", at: "2026-11-16T05:15:00.000Z" }], [msg("out", "Это *80 000 ₸*. Оформляю на этот объём?", "2026-11-16T05:15:01.000Z")], PHONE, now).length, 0);
check("нечего добавлять — память та же", withMissingOutgoing(memory, []) === memory, true);

console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : "\nВсе проверки прошли.");
process.exit(fails ? 1 : 0);
