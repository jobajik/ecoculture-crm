/* Заказ бота в полный цикл: разбор, проверка по складу и прайсу, тексты, бот без бонуса. */
import {
  botInvoiceErrorText,
  botOrderText,
  botPaidText,
  botReminderText,
  botDeclinedText,
  botDeclinedReminderText,
  botCancelledText,
  newClientName,
  toWhatsApp,
  normalizeGrade,
  parseBotOrder,
  planBotOrder,
  type BotOrderDraft,
} from "../src/lib/botOrder";
import { getLeaderboard } from "../src/lib/leaderboard";
import { botPaidAlertText, botSaleAlertText, coveredByOrder, managerOrderNote, phoneKeysClose } from "../src/lib/botOrder";
import { staffPhoneKeys } from "../src/lib/botSalesAlert";
import { BOT_MANAGER_EMAIL, BOT_MANAGER_NAME } from "../src/lib/botIdentity";
import { nameIndex, personName } from "../src/lib/personName";
import { followupRunDue, followupRunText } from "../src/lib/botFollowUpRun";
import { clientHistoryLines, duplicateOfHuman } from "../src/lib/botOrderRunner";
import { parsePush, pushLineText, pushLines, pushPromptBlock, pushUnitPrice } from "../src/lib/salesPush";
import { mentionedGrades, nudgeDue, nudgeStatus, nudgeTask, nudgeText, parseNudgeDecision, pickNudgeOffers } from "../src/lib/botNudge";
import type { BotChat, BotSettings } from "../src/lib/broadcast";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

async function main() {
  console.log("Разбор ответа модели");
  check("мусор — пустой неподтверждённый", parseBotOrder(null).confirmed, false);
  check("подтверждён без позиций — не заказ", parseBotOrder({ confirmed: true, items: [] }).confirmed, false);
  const parsed = parseBotOrder({
    confirmed: true,
    items: [{ flowerType: "Chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 100.4 }],
    deliveryDate: "2026-10-02",
    city: "Алматы",
    shopName: "",
    address: "",
    note: "",
  });
  check("цветок к нижнему регистру, штуки целые", [parsed.items[0].flowerType, parsed.items[0].quantity], ["chrysanthemum", 100]);

  console.log("\nГрадация как пишет клиент");
  check("хризантема «3 категория» → Третья", normalizeGrade("chrysanthemum", "3 категория"), "Третья");
  check("хризантема «высшая» → Высшая", normalizeGrade("chrysanthemum", "высшая"), "Высшая");
  check("роза «60 см» → 60", normalizeGrade("rose", "60 см"), "60");
  check("роза «60 (2 сорт)» узнаётся", normalizeGrade("rose", "60 (2 сорт)"), "60 (2 сорт)");
  check("выдуманная — пусто", normalizeGrade("rose", "65"), "");

  console.log("\nМожно ли оформить");
  const stock = [
    { flower: "chrysanthemum", variety: "Altaj", grade: "Высшая", qty: 1200 },
    { flower: "chrysanthemum", variety: "Altaj", grade: "Третья", qty: 450 },
    { flower: "rose", variety: "Red Naomi", grade: "60", qty: 800 },
  ];
  const prices: Record<string, number> = { "chrysanthemum|Altaj|Высшая": 580, "chrysanthemum|Altaj|Третья": 270, "rose|Red Naomi|60": 220 };
  const priceOf = (f: string, v: string, g: string) => prices[`${f}|${v}|${g}`] ?? 0;
  const draft = (patch: Partial<BotOrderDraft> = {}): BotOrderDraft => ({
    confirmed: true,
    items: [{ flowerType: "chrysanthemum", variety: "altaj", grade: "3", quantity: 100 }],
    deliveryDate: "2026-10-02",
    city: "Алматы",
    shopName: "",
    address: "",
    note: "",
    ...patch,
  });
  const today = "2026-10-01";
  check("хороший заказ: сорт по складу, цена из прайса", planBotOrder({ draft: draft(), stock, priceOf, today }), {
    ok: true,
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 100, unitPrice: 270 }],
    deliveryDate: "2026-10-02",
  });
  const q = (patch: Partial<BotOrderDraft>) => {
    const r = planBotOrder({ draft: draft(patch), stock, priceOf, today });
    return r.ok ? "ОФОРМИЛ" : r.question;
  };
  check("без даты — спросить день", q({ deliveryDate: "" }), "На какой день сделать доставку?");
  check("вчерашняя дата — спросить день", q({ deliveryDate: "2026-09-30" }), "На какой день сделать доставку?");
  check("через месяц — спросить день", q({ deliveryDate: "2026-11-15" }), "На какой день сделать доставку?");
  check(
    "больше склада — предложить, сколько есть",
    q({ items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 600 }] }),
    "Хризантема Altaj, Третья сейчас есть около 450 шт. Поставить 450?"
  );
  check(
    "две строки одной позиции складываются и проверяются вместе",
    q({
      items: [
        { flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 300 },
        { flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 300 },
      ],
    }),
    "Хризантема Altaj, Третья сейчас есть около 450 шт. Поставить 450?"
  );
  check(
    "сорта нет на складе — назвать, что есть",
    q({ items: [{ flowerType: "rose", variety: "Avalanche", grade: "60", quantity: 100 }] }),
    "Какой сорт роза поставить? Сейчас есть: Red Naomi."
  );
  check(
    "длины нет — назвать, какие есть",
    q({ items: [{ flowerType: "rose", variety: "Red Naomi", grade: "70", quantity: 100 }] }),
    "Роза Red Naomi: какую длину поставить? Есть: 60 см."
  );
  check(
    "нет цены — не оформлять по нулю",
    planBotOrder({ draft: draft({ items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 10 }] }), stock, priceOf: () => 0, today }).ok,
    false
  );
  check("ноль штук — спросить", q({ items: [{ flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 0 }] }), "Сколько штук «Роза Red Naomi, 60 см» поставить?");
  check("не подтверждён — не оформлять", planBotOrder({ draft: draft({ confirmed: false }), stock, priceOf, today }).ok, false);

  console.log("\nТексты клиенту");
  const text = botOrderText({
    code: "71YDW",
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 100, unitPrice: 270 }],
    deliveryDate: "2026-10-02",
    city: "Алматы",
    invoices: [{ farmLabel: "Есентай Агро Хим", amount: 27000, result: "sent", phone: "87014050523" }],
  });
  check("подтверждение: блоками, номер и сумма жирным", text.split("\n"), [
    "*Заказ №71YDW оформлен*",
    "",
    "• Хризантема Altaj, Третья — 100 шт. × 270 ₸",
    "",
    "Итого: *27 000 ₸*",
    "Доставка: 02.10, Алматы",
    "",
    "Счёт Kaspi на *27 000 ₸* отправлен на номер 8 701 405 05 23 — оплатите в приложении Kaspi.",
    "",
    "После оплаты заказ сразу уйдёт на сборку — я напишу.",
  ]);
  const mixed = botOrderText({
    code: "AB123",
    items: [
      { flowerType: "rose", variety: "Red Naomi", grade: "60", quantity: 100, unitPrice: 220 },
      { flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantity: 50, unitPrice: 580 },
    ],
    deliveryDate: "2026-10-03",
    city: "",
    invoices: [
      { farmLabel: "Rose Farm", amount: 22000, result: "manual", phone: "" },
      { farmLabel: "Есентай Агро Хим", amount: 29000, result: "sent", phone: "87014050523" },
    ],
  });
  // 14.10.2026: бот спросил «заберёте или доставить?» вместо счёта. Теперь адрес спрашивается ПОСЛЕ оформления.
  const noAddr = botOrderText({
    code: "K1531",
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantity: 100, unitPrice: 580 }],
    deliveryDate: "2026-10-14",
    city: "Алматы",
    invoices: [{ farmLabel: "Есентай Агро Хим", amount: 58000, result: "sent", phone: "87012761531" }],
    address: "",
  });
  check("адреса нет — один вопрос в подтверждении", noAddr.includes("Напишите адрес доставки — или заберёте сами из офиса."), true);
  check("адрес есть — не спрашиваем", botOrderText({ code: "K1", items: [], deliveryDate: "2026-10-14", city: "", invoices: [], address: "Абая 10" }).includes("адрес"), false);
  check("новый клиент без названия — имя WhatsApp", newClientName("", "Айгуль 🌸", "+77012761531"), "Айгуль");
  check("новый клиент без имени — по номеру", newClientName("", "", "77012761531"), "Клиент WhatsApp 1531");
  check("названная точка важнее имени", newClientName("Цветы Рядом", "Айгуль", "77012761531"), "Цветы Рядом");
  check("две компании: касса не подключена — «пришлём отдельно»", mixed.includes("Счёт (Rose Farm) на *22 000 ₸* пришлём сюда же"), true);
  check("две компании: счёт Есентая с подписью", mixed.includes("Счёт Kaspi (Есентай Агро Хим) на *29 000 ₸* отправлен") && mixed.includes("= 22 000 ₸"), true);
  check("оплата полностью — на сборку", botPaidText({ code: "71YDW", amount: 27000, fullyPaid: true, deliveryDate: "2026-10-02" }).includes("передан на сборку, доставка 02.10"), true);
  check("оплата частью — ждём второй счёт", botPaidText({ code: "AB123", amount: 29000, fullyPaid: false, deliveryDate: "2026-10-03" }).includes("второму счёту"), true);
  check("счёт не дошёл — попросить номер", botInvoiceErrorText({ code: "71YDW", phone: "87014050523", reason: "номер не найден в Kaspi" }).includes("Напишите номер"), true);
  check("напоминание: перевыставлен", botReminderText({ code: "71YDW", amount: 27000, reissued: true }).includes("выставил новый"), true);
  const declined = botDeclinedText({ code: "CNF9X", amount: 27000 });
  check("счёт отклонён: номер, сумма и вопрос", declined.includes("№CNF9X") && declined.includes("*27 000 ₸*") && declined.includes("?"), true);
  check("счёт отклонён: выходы списком", declined.split("\n").filter((l) => l.startsWith("• ")).length, 4);
  check("Markdown модели → WhatsApp", toWhatsApp("**Итого:** 27 000 ₸\n\n\n\n- Altaj — 270 ₸\n### Шапка"), "*Итого:* 27 000 ₸\n\n• Altaj - 270 ₸\nШапка");
  check("назавтра после отказа — держать ли заказ", botDeclinedReminderText({ code: "CNF9X", amount: 27000 }).includes("Держать заказ"), true);
  check("отмена заказа", botCancelledText("CNF9X"), "Заказ №CNF9X отменил.");

  console.log("\nБот в рейтинге — без бонуса");
  check("имя бота вместо почты", personName(BOT_MANAGER_EMAIL, nameIndex([])), BOT_MANAGER_NAME);
  const order = {
    orderId: "ORD-BOT1",
    clientName: "Клиент",
    clientPhone: "+77014050523",
    managerEmail: BOT_MANAGER_EMAIL,
    status: "new",
    notes: "",
    deliveryDate: "2026-09-08",
    createdAt: "2026-09-08T09:00:00",
    managerConfirmed: true,
    managerConfirmedAt: "",
    paid: true,
    paidAmount: 27000,
    promisedAt: "",
    collectionNote: "",
    paidAt: "2026-09-08T10:00:00",
    paymentMethod: "Каспи",
    accountantEmail: "",
    totalAmount: 27000,
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 100, unitPrice: 270, shippedQuantity: 0 }],
  };
  const lb = await getLeaderboard("month", undefined, new Date("2026-09-08T12:00:00"), {
    orders: [order] as never,
    users: [] as never,
    plans: new Map(),
  });
  const row = lb.rows.find((r) => r.managerEmail === BOT_MANAGER_EMAIL);
  check("строка бота: продажи видны, бонус ноль", row ? [row.name, row.paidAmount, row.bonus, row.pendingBonus] : null, [BOT_MANAGER_NAME, 27000, 0, 0]);

  console.log("\nДожим молчащего клиента");
  const on: BotSettings = { enabled: true, scope: "broadcast", hours: "always", workFrom: 9, workTo: 19, instructions: "" };
  const t = (h: number) => new Date(Date.parse("2026-10-01T06:00:00Z") + h * 3600000).toISOString();
  const nowN = new Date("2026-10-01T06:00:00Z"); // 11:00 по Алматы
  const talk = (patch: Partial<BotChat> = {}): BotChat => ({
    phone: "77014050523",
    updatedAt: t(-2),
    mode: "bot",
    humanAt: "",
    handoffAt: "",
    handoffReason: "",
    lastInMessageId: "",
    ourIds: ["wz-1"],
    context: [
      { role: "client", text: "Какая категория есть?", at: t(-3.5) },
      { role: "us", text: "Altaj высшая 580 ₸, первая 530 ₸. Сколько поставить?", at: t(-3.1) },
    ],
    name: "",
    botReplies: 1,
    nudge: { count: 0, at: "", done: false },
    ...patch,
  });
  const due = (c: BotChat, hour = 11, now = nowN) => nudgeDue({ settings: on, chat: c, now, hour });
  check("клиент молчит 3 ч после нашего ответа — первое касание", due(talk()), 1);
  check("прошло 2 ч — рано (раньше дожимали через 1,5 ч)", due(talk({ context: [talk().context[0], { ...talk().context[1], at: t(-2) }] })), 0);
  check("прошёл час — рано", due(talk({ context: [talk().context[0], { ...talk().context[1], at: t(-1) }] })), 0);
  check("прошло полчаса — рано", due(talk({ context: [talk().context[0], { ...talk().context[1], at: t(-0.5) }] })), 0);
  check("последним писал клиент — это не молчание", due(talk({ context: [talk().context[1], talk().context[0]] })), 0);
  check("клиент ни разу не отвечал (только рассылка) — не дожимаем", due(talk({ context: [talk().context[1]] })), 0);
  check("ночью — нет", due(talk(), 23), 0);
  check("рано утром — нет", due(talk(), 8), 0);
  check("отписался — нет", due(talk({ mode: "optout" })), 0);
  check("менеджер писал 2 ч назад — нет", due(talk({ humanAt: t(-2) })), 0);
  check("менеджер писал в чате 5 дней назад — чат его, нет", due(talk({ humanAt: t(-120) })), 0);
  check("менеджер писал месяц назад — можно", due(talk({ humanAt: t(-24 * 30) })), 1);
  check("бот выключен — нет", nudgeDue({ settings: { ...on, enabled: false }, chat: talk(), now: nowN, hour: 11 }), 0);
  check("модель закрыла дожим — нет", due(talk({ nudge: { count: 1, at: t(-5), done: true } })), 0);
  check("после первого касания час — рано для второго", due(talk({ nudge: { count: 1, at: t(-1), done: false } })), 0);
  check("после первого касания 10 ч — рано для второго", due(talk({ nudge: { count: 1, at: t(-10), done: false } })), 0);
  check("после первого касания назавтра (20 ч) — второе", due(talk({ nudge: { count: 1, at: t(-20.5), done: false } })), 2);
  check("два касания были — хватит", due(talk({ nudge: { count: 2, at: t(-30), done: false } })), 0);
  check("причина «рано» видна", nudgeStatus({ settings: on, chat: talk({ nudge: { count: 1, at: t(-1), done: false } }), now: nowN, hour: 11 }).reason.startsWith("рано"), true);
  check(
    "клиент молчит больше трёх дней — разговор закончен",
    due(talk({ context: [{ role: "client", text: "да", at: t(-80) }, { role: "us", text: "Сколько?", at: t(-79) }] })),
    0
  );
  check("последнее (второе) касание — мягкое", nudgeTask(2, 20).includes("последнее касание"), true);
  check("решение модели: мусор — не писать", parseNudgeDecision(null).nudge, false);
  const nstock = [
    { flower: "rose", variety: "Jumilia", grade: "60", qty: 900 },
    { flower: "chrysanthemum", variety: "Altaj", grade: "Высшая", qty: 300 },
    { flower: "rose", variety: "Jumilia", grade: "Уценка", qty: 5000 },
    { flower: "eustoma", variety: "Alissa White", grade: "Стандарт", qty: 50 },
  ];
  const nprices: Record<string, number> = { "rose|Jumilia|60": 220, "chrysanthemum|Altaj|Высшая": 580, "rose|Jumilia|Уценка": 90, "eustoma|Alissa White|Стандарт": 400 };
  const offers = pickNudgeOffers({
    stock: nstock,
    priceOf: (f, v, g) => nprices[`${f}|${v}|${g}`] ?? 0,
    mentioned: "Клиент: а Алтай есть?",
    isLiquid: (f, g) => g !== "Уценка",
  });
  check("предложение: сначала то, о чём спрашивали, цена из прайса, без уценки и мелких остатков", offers.map((o) => `${o.variety} ${o.grade} ${o.price}`), ["Altaj Высшая 580", "Jumilia 60 220"]);
  // Тансулу, 13.10: «3 котегор канша?» про Altaj — касание про третью Altaj, а не про ходовой Chik.
  check("названные категории: «3 котегор канша?»", mentionedGrades("3 котегор канша?"), ["Третья"]);
  check("названные категории: казахский и длина", mentionedGrades("үшінші бар ма? и розу 60 см"), ["Третья", "60"]);
  check("названные категории: «первую» и «2 кат»", mentionedGrades("первую или 2 кат"), ["Первая", "Вторая"]);
  check("без категорий — пусто", mentionedGrades("Здравствуйте, прайс?"), []);
  const asked = pickNudgeOffers({
    stock: [...nstock, { flower: "chrysanthemum", variety: "Altaj", grade: "Третья", qty: 80 }, { flower: "chrysanthemum", variety: "Chik", grade: "Первая", qty: 2000 }],
    priceOf: (f, v, g) => ({ ...nprices, "chrysanthemum|Altaj|Третья": 300, "chrysanthemum|Chik|Первая": 450 } as Record<string, number>)[`${f}|${v}|${g}`] ?? 0,
    mentioned: "Клиент: Алтай 3 котегор канша?",
    isLiquid: (f, g) => !["Уценка", "Третья"].includes(g),
    clientText: "Алтай 3 котегор канша?",
  });
  check("дожим: первой — та категория, о которой спросили (даже не ходовая)", asked.map((o) => `${o.variety} ${o.grade}`)[0], "Altaj Третья");
  // Распродажа 4-й категории (13.10.2026): от 1 000 шт. — 160 ₸, бот и дожим предлагают её первой.
  const push = parsePush('[{"flowerType":"chrysanthemum","grade":"Четвёртая","bulkFrom":1000,"bulkPrice":160}]');
  check("распродажа: настройка читается", push.length, 1);
  check("распродажа: мусор в настройке — распродажи нет", parsePush("не json").length + parsePush("").length, 0);
  check("цена от объёма: 999 шт. — прайс, 1 000 — 160", [pushUnitPrice(push, "chrysanthemum", "Четвёртая", 999, 180), pushUnitPrice(push, "chrysanthemum", "Четвертая", 1000, 180)], [180, 160]);
  check("цена от объёма: другая позиция — прайс", pushUnitPrice(push, "chrysanthemum", "Третья", 5000, 270), 270);
  const pstock = [
    { flower: "chrysanthemum", variety: "Altaj", grade: "Четвёртая", qty: 39190 },
    { flower: "chrysanthemum", variety: "Chik", grade: "Четвёртая", qty: 3440 },
    { flower: "chrysanthemum", variety: "Altaj", grade: "Высшая", qty: 300 },
  ];
  const plines = pushLines(push, pstock, (_f, v) => (v === "Altaj" ? 180 : 120));
  check("строка распродажи", pushLineText(plines[0]), "Хризантема, четвёртая категория — около 42 000 шт.: Altaj 180 ₸, Chik 120 ₸; от 1 000 шт. — 160 ₸");
  check("блок подсказки бота есть", pushPromptBlock(plines).startsWith("РАСПРОДАЁМ В ПЕРВУЮ ОЧЕРЕДЬ"), true);
  check("позиции нет на складе — блока нет", pushPromptBlock(pushLines(push, [], () => 0)), "");
  const pushOffers = pickNudgeOffers({
    stock: [...pstock, { flower: "chrysanthemum", variety: "Bacardy", grade: "Высшая", qty: 500 }],
    priceOf: (f, v, g) => (g === "Высшая" ? 580 : v === "Altaj" ? 180 : 120),
    mentioned: "",
    isLiquid: (f, g) => g === "Высшая",
    isPush: (f, g) => f === "chrysanthemum" && g === "Четвёртая",
  });
  check("дожим: распродажа первой, потом ходовая", pushOffers.map((o) => `${o.variety} ${o.grade}`), ["Altaj Четвёртая", "Bacardy Высшая"]);
  const lbl = (o: { variety: string; grade: string }) => `${o.variety}, ${o.grade}`;
  check("касание 1 — списком с ценами", nudgeText(1, offers, lbl).split("\n"), [
    "Здравствуйте! Сегодня свежий срез:",
    "",
    "• Altaj, Высшая — *580 ₸*",
    "• Jumilia, 60 — *220 ₸*",
    "",
    "Поставить вам на завтра? Для пробы — от 50 шт.",
  ]);
  check("касание 2 (последнее) — мягкое без цен", nudgeText(2, offers, lbl).startsWith("Если цветы понадобятся"), true);
  check("в касании заказ не оформляется", nudgeTask(1, 1).includes("order.confirmed=false"), true);
  const runAt = new Date("2026-10-01T11:00:00Z");
  const lastRun = followupRunText(runAt, "вебхук", "дожато 1");
  check("запуск дожима: запись начинается со времени", lastRun.startsWith("2026-10-01T11:00:00.000Z · вебхук"), true);
  check("через 10 минут — рано", followupRunDue(lastRun, new Date(runAt.getTime() + 10 * 60000)), false);
  check("через 25 минут — пора", followupRunDue(lastRun, new Date(runAt.getTime() + 25 * 60000)), true);
  check("запусков не было — пора", followupRunDue("", runAt), true);

  console.log("\nПродажи бота — сообщение команде");
  const sale = botSaleAlertText({
    code: "AB12C",
    clientName: "Цветы Достык",
    phone: "+77011234567",
    city: "Алматы",
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 100, unitPrice: 350 }],
    deliveryDate: "2026-10-03",
    store: "office",
    invoices: [{ farm: "esentai", farmLabel: "Есентай Агро Хим", amount: 35000, phone: "87011234567", result: "sent", error: "" } as never],
  });
  check("заказ: номер, клиент, сумма, офис, счёт", [
    sale.includes("заказ №AB12C"),
    sale.includes("Цветы Достык, +77011234567, Алматы"),
    sale.includes("*35 000 ₸*"),
    sale.includes("Офис — отправка такси"),
    sale.includes("ждём оплату"),
  ], [true, true, true, true, true]);
  const paidAlert = botPaidAlertText({
    code: "AB12C", clientName: "Цветы Достык", amount: 35000, fullyPaid: true, farmLabel: "Есентай Агро Хим",
    items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 100 }], deliveryDate: "2026-10-03", store: "",
  });
  check("оплата: можно собирать с основного склада", [paidAlert.startsWith("*Оплачено — заказ №AB12C*"), paidAlert.includes("Можно собирать: основной склад")], [true, true]);
  check("оплата частями — ждём второй счёт", botPaidAlertText({ code: "X", clientName: "К", amount: 1, fullyPaid: false, farmLabel: "Rose Farm", items: [], deliveryDate: "", store: "" }).includes("второго счёта"), true);
  check("сотрудникам бот не отвечает: номера сводки и продаж", Array.from(staffPhoneKeys({ DigestPhones: "+77011112233", BotSalesPhones: "+7 702 444 55 66, 87011112233" })).sort(), ["7011112233", "7024445566"]);

  console.log("\nДубль заявки менеджера (20.10.2026, Лена Фабричный)");
  const sig = (items: { flowerType: string; variety: string; grade: string; quantity: number }[]) =>
    items.map((i) => `${i.flowerType}|${i.variety}|${i.grade}|${i.quantity}`).sort().join(";");
  const human = { ...order, orderId: "ORD-QPXPB", managerEmail: "emil@x.kz", clientPhone: "+77085755681", clientId: "CLI-1", createdAt: "2026-10-20T06:26:00Z", items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantity: 200, unitPrice: 580, shippedQuantity: 0 }] };
  const want = [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantity: 200 }];
  const at = new Date("2026-10-20T06:55:00Z");
  check("та же заявка менеджера полчаса назад — дубль", duplicateOfHuman([human] as never, "+77085755681", "", want, sig, at)?.orderId ?? null, "ORD-QPXPB");
  check("по карточке клиента — тоже дубль", duplicateOfHuman([human] as never, "+77000000000", "CLI-1", want, sig, at)?.orderId ?? null, "ORD-QPXPB");
  check("другое количество, заявка не отгружена — тоже дубль", duplicateOfHuman([human] as never, "+77085755681", "", [{ ...want[0], quantity: 300 }], sig, at)?.orderId ?? null, "ORD-QPXPB");
  const shippedHuman = { ...human, status: "shipped", items: [{ ...human.items[0], shippedQuantity: 200 }] };
  check("другое количество, заявка уже отгружена — новый заказ", duplicateOfHuman([shippedHuman] as never, "+77085755681", "", [{ ...want[0], quantity: 300 }], sig, at), null);

  console.log("\nДубли после менеджеров (21.10.2026, Сабина и Танзиля)");
  check("номер с одной опечаткой — тот же", [phoneKeysClose("7778228310", "7778228210"), phoneKeysClose("7778228310", "7778221210"), phoneKeysClose("7778228310", ""), phoneKeysClose("123", "124")], [true, false, false, false]);
  const sabina = { ...human, orderId: "ORD-K0DI0", clientPhone: "87778228210", clientId: "CLI-UM2XU", createdAt: "2026-10-21T06:20:35Z", items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 100, unitPrice: 400, shippedQuantity: 0 }] };
  const sabinaWant = [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 100 }];
  check("Сабина: заявка Эмиля с опечаткой в номере — дубль", duplicateOfHuman([sabina] as never, "77778228310", "", sabinaWant, sig, new Date("2026-10-21T06:26:59Z"))?.orderId ?? null, "ORD-K0DI0");
  check("другой человек (две цифры разные) — не дубль", duplicateOfHuman([sabina] as never, "77778221310", "", sabinaWant, sig, new Date("2026-10-21T06:26:59Z")), null);
  const tanzilya = { ...human, orderId: "ORD-7SF2P", clientPhone: "+77011564086", clientId: "CLI-T", createdAt: "2026-10-20T11:37:52Z", items: [
    { flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 60, unitPrice: 235, shippedQuantity: 0 },
    { flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 30, unitPrice: 400, shippedQuantity: 0 },
  ] };
  const t2 = new Date("2026-10-20T13:11:00Z");
  check("Танзиля: часть заказа Ильяса (Altaj Вторая) — дубль", duplicateOfHuman([tanzilya] as never, "77011564086", "", [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 30 }], sig, t2)?.orderId ?? null, "ORD-7SF2P");
  check("позиция, которой в заявке нет (Jumilia 50), — не дубль", duplicateOfHuman([tanzilya] as never, "77011564086", "", [{ flowerType: "rose", variety: "Jumilia", grade: "50", quantity: 60 }], sig, t2), null);
  check("старше 48 ч — не дубль", duplicateOfHuman([tanzilya] as never, "77011564086", "", [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 30 }], sig, new Date("2026-10-22T12:00:00Z")), null);
  check("позиции покрыты: сорт без учёта регистра", [coveredByOrder([{ flowerType: "rose", variety: "jumilia", grade: "60" }], tanzilya.items), coveredByOrder([], tanzilya.items)], [true, false]);
  check("подсказка модели видит заявку с опечаткой в номере", clientHistoryLines({ orders: [sabina] as never, phone: "77778228310", clientId: "", now: new Date("2026-10-21T06:26:00Z") }).some((l) => l.startsWith("ВАЖНО") && l.includes("№K0DI0")), true);
  const lockNote = managerOrderNote("Эмиль", sabinaWant);
  check("записка: разговор вёл менеджер — заказ не оформлен", [lockNote.startsWith("внимание:"), lockNote.includes("Altaj, Вторая — 100 шт."), lockNote.includes("(Эмиль)"), lockNote.includes("НЕ оформил")], [true, true, true, true]);
  check("отменённая не считается", duplicateOfHuman([{ ...human, status: "cancelled" }] as never, "+77085755681", "", want, sig, at), null);
  check("старше суток — не дубль", duplicateOfHuman([{ ...human, createdAt: "2026-10-18T06:26:00Z" }] as never, "+77085755681", "", want, sig, at), null);
  const hist = clientHistoryLines({ orders: [human] as never, phone: "+77085755681", clientId: "", now: at });
  check("в подсказке модели — «уже оформлено, заново не оформляй»", hist.some((l) => l.startsWith("ВАЖНО") && l.includes("№QPXPB") && l.includes("НЕ оформляй")), true);
  check("старый заказ в подсказке без «ВАЖНО»", clientHistoryLines({ orders: [{ ...human, createdAt: "2026-10-10T06:26:00Z" }] as never, phone: "+77085755681", clientId: "", now: at }).some((l) => l.startsWith("ВАЖНО")), false);

  console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
