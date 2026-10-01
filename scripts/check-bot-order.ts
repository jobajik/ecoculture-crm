/* Заказ бота в полный цикл: разбор, проверка по складу и прайсу, тексты, бот без бонуса. */
import {
  botInvoiceErrorText,
  botOrderText,
  botPaidText,
  botReminderText,
  normalizeGrade,
  parseBotOrder,
  planBotOrder,
  type BotOrderDraft,
} from "../src/lib/botOrder";
import { getLeaderboard } from "../src/lib/leaderboard";
import { BOT_MANAGER_EMAIL, BOT_MANAGER_NAME } from "../src/lib/botIdentity";
import { nameIndex, personName } from "../src/lib/personName";
import { nudgeDue, nudgeTask } from "../src/lib/botNudge";
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
  check("подтверждение: номер, позиция, итог, счёт", text.split("\n"), [
    "Заказ №71YDW оформлен:",
    "• Хризантема Altaj, Третья — 100 шт. × 270 ₸ = 27 000 ₸",
    "Итого: 27 000 ₸. Доставка: 02.10, Алматы.",
    "",
    "Счёт Kaspi на 27 000 ₸ отправлен на номер 8 701 405 05 23 — оплатите в приложении Kaspi.",
    "Как только оплата придёт, заказ уйдёт на сборку — я сразу напишу.",
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
  check("две компании: касса не подключена — «пришлём отдельно»", mixed.includes("Счёт (Rose Farm) на 22 000 ₸ пришлём сюда же"), true);
  check("две компании: счёт Есентая с подписью", mixed.includes("Счёт Kaspi (Есентай Агро Хим) на 29 000 ₸ отправлен"), true);
  check("оплата полностью — на сборку", botPaidText({ code: "71YDW", amount: 27000, fullyPaid: true, deliveryDate: "2026-10-02" }).includes("передан на сборку, доставка 02.10"), true);
  check("оплата частью — ждём второй счёт", botPaidText({ code: "AB123", amount: 29000, fullyPaid: false, deliveryDate: "2026-10-03" }).includes("второму счёту"), true);
  check("счёт не дошёл — попросить номер", botInvoiceErrorText({ code: "71YDW", phone: "87014050523", reason: "номер не найден в Kaspi" }).includes("Напишите номер"), true);
  check("напоминание: перевыставлен", botReminderText({ code: "71YDW", amount: 27000, reissued: true }).includes("выставил новый"), true);

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
      { role: "client", text: "Какая категория есть?", at: t(-2) },
      { role: "us", text: "Altaj высшая 580 ₸, первая 530 ₸. Сколько поставить?", at: t(-1.5) },
    ],
    name: "",
    botReplies: 1,
    nudge: { count: 0, at: "", done: false },
    ...patch,
  });
  const due = (c: BotChat, hour = 11, now = nowN) => nudgeDue({ settings: on, chat: c, now, hour });
  check("клиент молчит 1,5 ч после нашего ответа — первое касание", due(talk()), 1);
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
  check("после первого касания 2 ч — рано для второго", due(talk({ nudge: { count: 1, at: t(-2), done: false } })), 0);
  check("после первого касания 3 ч — второе", due(talk({ nudge: { count: 1, at: t(-3), done: false } })), 2);
  check("после второго 10 ч — рано для третьего", due(talk({ nudge: { count: 2, at: t(-10), done: false } })), 0);
  check("после второго назавтра — третье", due(talk({ nudge: { count: 2, at: t(-21), done: false } })), 3);
  check("три касания были — хватит", due(talk({ nudge: { count: 3, at: t(-48), done: false } })), 0);
  check(
    "клиент молчит больше трёх дней — разговор закончен",
    due(talk({ context: [{ role: "client", text: "да", at: t(-80) }, { role: "us", text: "Сколько?", at: t(-79) }] })),
    0
  );
  check("последнее касание — мягкое", nudgeTask(3, 20).includes("последнее касание"), true);
  check("в касании заказ не оформляется", nudgeTask(1, 1).includes("order.confirmed=false"), true);

  console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
