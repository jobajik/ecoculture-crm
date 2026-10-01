/*
 * Рассылки WhatsApp (Green API) и бот-автоответчик — чистые правила.
 *
 * Что стережём:
 *   - номер: городской и мусор в WhatsApp не уходят, «8…» и «+7…» — одно;
 *   - текст: {имя} подставляется, без имени фраза не ломается, «ответьте СТОП»;
 *   - кому: отписавшимся и повторам номера не пишем, клиент важнее лида;
 *   - отчёт: лучший статус, ответ — только ПОСЛЕ отправки, ошибка перебивает «отправлено»;
 *   - бот: когда молчит (человек в чате, передано, отписка, не из рассылки,
 *     рабочее время, повтор уведомления), разбор ответа модели;
 *   - разбор уведомлений Green API (статусы, эхо API, отказы отправки);
 *   - подпись ссылки на файл.
 *
 * Запуск: npx tsx scripts/check-broadcasts.ts
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-checks";

import { fillPrices, insertTag, priceBlock, priceTagFlowers, priceTagOptions, priceTagsRefusal } from "../src/lib/broadcastPrices";
import {
  BOT_HANDOFF_TEXT,
  OPT_OUT_LINE,
  botDecision,
  botSettingsFrom,
  botSilenceReason,
  broadcastTextRefusal,
  broadcastTotals,
  dailyLimitOf,
  deliveryByMessage,
  greetingName,
  isAckOnly,
  isOptOutText,
  nextGapSeconds,
  personalize,
  prepareAudience,
  pushContext,
  recipientViews,
  sendTooSoon,
  sentOnDay,
  waPhone,
  type AudienceCandidate,
  type BotChat,
  type BotSettings,
  type RecipientRow,
} from "../src/lib/broadcast";
import {
  MAX_CAPTION,
  botIncomingOf,
  greenFailureKind,
  channelProblem,
  greenFileName,
  greenSendErrorText,
  greenStateText,
  parseGreenStatus,
} from "../src/lib/greenOut";
import { parseGreenWebhook } from "../src/lib/whatsapp";
import { lastBroadcastForBot, pricesForBot, roughStems, stockForBot } from "../src/lib/botKnowledge";
import {
  analysisIsStale,
  broadcastTranscript,
  kindCounts,
  ordersAfterBroadcast,
  parseBroadcastAnalysis,
  type OrderLite,
} from "../src/lib/broadcastAnalysis";
import { fileSignatureOk, publicFileUrl, safeFileName, signFileId } from "../src/lib/waFileSign";
import type { WaMessage } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

console.log("Номер");
check("8 701 → 7701", waPhone("8 701 555 20 30"), "77015552030");
check("+7 (747) → 7747", waPhone("+7 (747) 396-79-54"), "77473967954");
check("десять цифр", waPhone("7015552030"), "77015552030");
check("городской Алматы — нет", waPhone("8 727 250 00 00"), "");
check("городской Астана — нет", waPhone("+7 7172 55 55 55"), "");
check("российский мобильный", waPhone("8 916 123 45 67"), "79161234567");
check("Кыргызстан как есть", waPhone("+996 555 123 456"), "996555123456");
check("мусор — нет", waPhone("123"), "");
check("пусто — нет", waPhone(""), "");

console.log("\nТекст");
check("имя подставилось", personalize("Здравствуйте, {имя}! Прайс ниже.", "Айгуль", false), "Здравствуйте, Айгуль! Прайс ниже.");
check("без имени — без запятой", personalize("Здравствуйте, {имя}! Прайс ниже.", "", false), "Здравствуйте! Прайс ниже.");
check("{ имя } с пробелами", personalize("Привет, { имя }.", "Лена", false), "Привет, Лена.");
check("СТОП дописывается", personalize("Акция!", "", true), `Акция!\n\n${OPT_OUT_LINE}`);
check("СТОП не дублируется", personalize("Акция! Ответьте стоп.", "", true), "Акция! Ответьте стоп.");
check("имя: контактное лицо", greetingName("Айгуль", "Цветы 24"), "Айгуль");
check("имя: название, если лица нет", greetingName("", "Цветы 24"), "Цветы 24");
check("ИП в обращении не нужен", greetingName("", "ИП Жанибекова"), "Жанибекова");
check("«Без имени» — не имя", greetingName("", "Без имени"), "");
check("длинное название — не имя", greetingName("", "ТОО Цветочный дом на проспекте Абая, 150"), "");
check("пустое сообщение без файла — отказ", broadcastTextRefusal("  ", false) !== "", true);
check("только файл — можно", broadcastTextRefusal("", true), "");
check("стоп", isOptOutText("Стоп"), true);
check("STOP!", isOptOutText("STOP!"), true);
check("отписаться", isOptOutText("отписаться"), true);
check("«стоп, а цена?» — не отписка", isOptOutText("стоп, а сколько роза?"), false);
check("обычный ответ — не отписка", isOptOutText("Спасибо, интересно"), false);

console.log("\nКому");
const base: Omit<AudienceCandidate, "kind" | "refId" | "phone"> = {
  name: "Х",
  contactPerson: "",
  city: "Алматы",
  managerEmail: "",
  clientType: "",
  stage: "",
  campaign: "",
  segment: "",
  daysSinceOrder: null,
  flowers: [],
};
const aud = prepareAudience(
  [
    { ...base, kind: "lead", refId: "L1", phone: "+7 701 555 20 30" },
    { ...base, kind: "client", refId: "C1", phone: "87015552030" },
    { ...base, kind: "client", refId: "C2", phone: "8 727 250 00 00" },
    { ...base, kind: "lead", refId: "L2", phone: "87470000001" },
    { ...base, kind: "lead", refId: "L3", phone: "87470000002" },
  ],
  new Set(["7470000002"])
);
check("порядок сохранён", aud.map((a) => a.refId), ["L1", "C1", "C2", "L2", "L3"]);
check("лид с номером клиента — повтор", aud[0].excluded, "номер уже есть");
check("клиент важнее лида", aud[1].excluded, "");
check("городской — нет мобильного", aud[2].excluded, "нет мобильного");
check("обычный лид — пойдёт", aud[3].excluded, "");
check("отписавшийся — нет", aud[4].excluded, "отписался");

console.log("\nОтправка");
check("пауза не меньше 25 с", nextGapSeconds(() => 0), 25);
check("пауза не больше 50 с", nextGapSeconds(() => 1), 50);
const now = new Date("2026-09-28T10:00:00Z");
check("через 5 с — рано", sendTooSoon("2026-09-28T09:59:55Z", now), true);
check("через 30 с — можно", sendTooSoon("2026-09-28T09:59:30Z", now), false);
check("первое — можно", sendTooSoon("", now), false);
check("предел по умолчанию", dailyLimitOf(""), 150);
check("предел из настройки", dailyLimitOf("80"), 80);
check("предел — не больше 1000", dailyLimitOf("99999"), 1000);
check("мусор — по умолчанию", dailyLimitOf("много"), 150);

console.log("\nОтчёт");
const rows: RecipientRow[] = [
  { broadcastId: "B", phone: "77015552030", name: "А", kind: "lead", refId: "L1", managerEmail: "", status: "sent", messageId: "wz-1", sentAt: "2026-09-28T09:00:00.000Z", error: "" },
  { broadcastId: "B", phone: "77470000001", name: "Б", kind: "lead", refId: "L2", managerEmail: "", status: "sent", messageId: "wz-2", sentAt: "2026-09-28T09:01:00.000Z", error: "" },
  { broadcastId: "B", phone: "77470000003", name: "В", kind: "lead", refId: "L3", managerEmail: "", status: "sent", messageId: "wz-3", sentAt: "2026-09-28T09:02:00.000Z", error: "" },
  { broadcastId: "B", phone: "77470000004", name: "Г", kind: "lead", refId: "L4", managerEmail: "", status: "queued", messageId: "", sentAt: "", error: "" },
];
const delivery = deliveryByMessage([
  { messageId: "wz-1", at: "", status: "sent", error: "" },
  { messageId: "wz-1", at: "", status: "read", error: "" },
  { messageId: "wz-1", at: "", status: "delivered", error: "" },
  { messageId: "wz-2", at: "", status: "delivered", error: "" },
  { messageId: "wz-3", at: "", status: "error", error: "у номера нет WhatsApp" },
]);
check("прочитано перебивает доставлено, порядок не важен", delivery.get("wz-1")?.status, "read");
check("ошибка остаётся ошибкой", delivery.get("wz-3")?.status, "error");
const msg = (phone: string, at: string, direction: "in" | "out" = "in"): WaMessage => ({
  messageId: `m-${phone}-${at}`,
  at,
  chatId: "",
  phone,
  direction,
  type: "text",
  text: "Интересно, пришлите прайс",
  mediaUrl: "",
  senderName: "",
  source: "webhook",
});
const views = recipientViews(rows, delivery, [
  msg("77015552030", "2026-09-28T09:30:00.000Z"),
  msg("77470000001", "2026-09-27T12:00:00.000Z"),
  msg("77470000001", "2026-09-28T09:05:00.000Z", "out"),
]);
check("ответ после отправки — ответил", views[0].state, "replied");
check("ответ ДО отправки — не ответ", views[1].state, "delivered");
check("ошибка доставки", [views[2].state, views[2].error], ["error", "у номера нет WhatsApp"]);
check("в очереди", views[3].state, "queued");
const totals = broadcastTotals(views, new Set(["5552030".padStart(10, "7").slice(-10)]));
check("воронка", [totals.total, totals.sent, totals.delivered, totals.read, totals.replied, totals.errors, totals.queued], [4, 2, 2, 1, 1, 1, 1]);
check("сегодня отправлено", sentOnDay(rows, "2026-09-28", (iso) => iso.slice(0, 10)), 3);

console.log("\nБот");
const on: BotSettings = { enabled: true, scope: "broadcast", hours: "always", workFrom: 9, workTo: 19, instructions: "" };
const chat = (patch: Partial<BotChat>): BotChat => ({
  phone: "77015552030",
  updatedAt: "",
  mode: "bot",
  humanAt: "",
  handoffAt: "",
  handoffReason: "",
  lastInMessageId: "",
  ourIds: ["wz-1"],
  context: [],
  name: "",
  botReplies: 0,
  ...patch,
});
const t0 = new Date("2026-09-28T14:00:00Z");
const ask = (settings: BotSettings, c: BotChat | null, hour = 20, messageId = "wz-9") => botSilenceReason({ settings, chat: c, messageId, now: t0, hour });
check("из рассылки — отвечает", ask(on, chat({})), "");
check("выключен — молчит", ask({ ...on, enabled: false }, chat({})), "бот выключен");
check("не из рассылки — молчит", ask(on, null), "не из рассылки");
check("режим «всем» — отвечает и незнакомым", ask({ ...on, scope: "all" }, null), "");
check("менеджер писал 2 ч назад — молчит", ask(on, chat({ humanAt: "2026-09-28T12:00:00Z" })), "в чате пишет менеджер");
check("менеджер писал вчера — отвечает", ask(on, chat({ humanAt: "2026-09-27T01:00:00Z" })), "");
check("передано менеджеру 20 мин назад — молчит", ask(on, chat({ mode: "handoff", handoffAt: "2026-09-28T13:40:00Z" })), "передано менеджеру");
check("передано 4 ч назад, менеджер не ответил — бот снова отвечает", ask(on, chat({ mode: "handoff", handoffAt: "2026-09-28T10:00:00Z" })), "");
check("передано, менеджер ответил — молчит", ask(on, chat({ mode: "handoff", handoffAt: "2026-09-28T10:00:00Z", humanAt: "2026-09-28T10:30:00Z" })), "в чате пишет менеджер");
check("передано 2 дня назад — снова отвечает", ask(on, chat({ mode: "handoff", handoffAt: "2026-09-26T10:00:00Z" })), "");
check("отписался — молчит", ask(on, chat({ mode: "optout" })), "клиент отписался");
check("повтор уведомления — молчит", ask(on, chat({ lastInMessageId: "wz-9" })), "повтор уведомления");
check("нерабочее время: днём молчит", ask({ ...on, hours: "offhours" }, chat({}), 11), "рабочее время — отвечают менеджеры");
check("нерабочее время: вечером отвечает", ask({ ...on, hours: "offhours" }, chat({}), 21), "");
check("8 ответов — ещё отвечает (заказ — это много реплик)", ask(on, chat({ botReplies: 8, updatedAt: "2026-09-28T13:00:00Z" })), "");
check("много ответов подряд — молчит", ask(on, chat({ botReplies: 20, updatedAt: "2026-09-28T13:00:00Z" })), "бот уже ответил много раз");
check("настройки из таблицы", botSettingsFrom({ BotEnabled: "TRUE", BotScope: "all", BotHours: "offhours", BotWorkFrom: "8", BotWorkTo: "20" }), {
  enabled: true,
  scope: "all",
  hours: "offhours",
  workFrom: 8,
  workTo: 20,
  instructions: "",
});
check("пустые настройки — выключен и осторожен", botSettingsFrom({}).enabled || botSettingsFrom({}).scope !== "broadcast", false);
const long = Array.from({ length: 30 }, (_, i) => ({ role: "client" as const, text: `сообщение ${i} `.repeat(20), at: "" }));
const ctx = long.reduce((acc, item) => pushContext(acc, item), [] as BotChat["context"]);
check("память бота короткая", ctx.length <= 12 && JSON.stringify(ctx).length <= 3000, true);
check("последнее сообщение в памяти", ctx[ctx.length - 1].text.startsWith("сообщение 29"), true);
check("ответ модели", botDecision({ reply: "Роза 60 см — 180 ₸.", handoff: false, reason: "" }), { reply: "Роза 60 см — 180 ₸.", handoff: false, reason: "", silent: false });
check("автоответ магазина — молчим", botDecision({ reply: "", handoff: false, reason: "", silent: true }).silent, true);
check("молчать нельзя, если зовёт человека", botDecision({ reply: "", handoff: true, reason: "заказ", silent: true }).silent, false);
check("кивки — не отвечаем", ["👍", "Спасибо!", "ок", "рахмет 🙏", "Спасибо большое"].map(isAckOnly), [true, true, true, true, true]);
check("вопрос и «да» — отвечаем", ["Да", "Сколько?", "Хочу 300 роз", "Хорошо, пришлите"].map(isAckOnly), [false, false, false, false]);
check("пустой ответ — передать человеку", botDecision({ reply: "", handoff: false }).handoff, true);
check("мусор — передать человеку", botDecision(null).handoff, true);
check("текст передачи есть", BOT_HANDOFF_TEXT.length > 10, true);

console.log("\nУведомления Green API");
const st = (status: string, extra: Record<string, unknown> = {}) =>
  parseGreenStatus({ typeWebhook: "outgoingMessageStatus", chatId: "77015552030@c.us", timestamp: 1790577000, idMessage: "3EB0AA", status, sendByApi: true, ...extra });
check("доставлено", [st("delivered")?.messageId, st("delivered")?.status, st("delivered")?.error], ["3EB0AA", "delivered", ""]);
check("прочитано", st("read")?.status, "read");
check("нет WhatsApp — ошибка", [st("noAccount")?.status, st("noAccount")?.error], ["error", "у номера нет WhatsApp"]);
check("сбой с описанием", st("failed", { description: "bad" })?.error, "не отправилось: bad");
check("ограничение номера — ошибка", st("suspended")?.error, "WhatsApp временно ограничил номер");
check("старое имя yellowCard понимается", st("yellowCard")?.status, "error");
check("переписка с телефона — не пишем", st("delivered", { sendByApi: false }), null);
check("незнакомый статус — мимо", st("weird"), null);
check("входящее сообщение — не статус", parseGreenStatus({ typeWebhook: "incomingMessageReceived" }), null);
check("номер под ограничением — пауза", greenStateText("suspended").includes("ограничил"), true);

const hook = (typeWebhook: string, text: string) => ({
  typeWebhook,
  timestamp: 1790577000,
  idMessage: `${typeWebhook}-1`,
  senderData: { chatId: "77015552030@c.us", senderName: "Айгуль" },
  messageData: { typeMessage: "textMessage", textMessageData: { textMessage: text } },
});
const inBody = hook("incomingMessageReceived", "Сколько роза?");
const apiBody = hook("outgoingAPIMessageReceived", "Рассылка");
const phoneBody = hook("outgoingMessageReceived", "Ответ менеджера");
const inMsg = botIncomingOf(inBody, parseGreenWebhook(inBody));
const apiMsg = botIncomingOf(apiBody, parseGreenWebhook(apiBody));
const phoneMsg = botIncomingOf(phoneBody, parseGreenWebhook(phoneBody));
check("входящее — клиент", [inMsg?.isEcho, inMsg?.fromApi, inMsg?.phone], [false, false, "77015552030"]);
check("через API — наше, не менеджер", [apiMsg?.isEcho, apiMsg?.fromApi], [true, true]);
check("с телефона — живой менеджер", [phoneMsg?.isEcho, phoneMsg?.fromApi], [true, false]);
check("нет сообщения — нет и бота", botIncomingOf(inBody, null), null);

check("лимит тарифа — пауза", greenFailureKind(466), "pause");
check("чужой ключ — пауза", greenFailureKind(401), "pause");
check("сбой связи — повтор", [greenFailureKind(0), greenFailureKind(502), greenFailureKind(429)], ["retry", "retry", "retry"]);
check("неверный номер — у получателя", greenFailureKind(400), "recipient");
// Проверка номера перед сообщением: разовый сбой не останавливает рассылку.
const act = (c: Parameters<typeof channelProblem>[0]) => channelProblem(c).action;
check("номер в сети — отправляем", act({ state: "authorized" }), "ok");
check("Green API не ответил / 5xx / 429 — повтор через минуту", [act({ httpStatus: 0 }), act({ httpStatus: 502 }), act({ httpStatus: 429 })], ["retry", "retry", "retry"]);
check("номер запускается — повтор", act({ state: "starting" }), "retry");
check("ключ, тариф, номер отключён — пауза", [act({ httpStatus: 401 }), act({ httpStatus: 466 }), act({ state: "notAuthorized" }), act({ state: "yellowCard" })], ["pause", "pause", "pause", "pause"]);
check("незнакомый отказ проверки — пауза с кодом", channelProblem({ httpStatus: 404 }), { action: "pause", text: "Green API отказал в проверке номера (код 404)" });
check("текст про тариф", greenSendErrorText(466, "").includes("«Бизнес»"), true);
check("состояние", [greenStateText("authorized"), greenStateText("notAuthorized").includes("QR")], ["работает", true]);
check("незнакомое состояние", greenStateText("odd"), "состояние «odd»");
check("имя файла с расширением", greenFileName("28.09.pdf", "application/pdf"), "28.09.pdf");
check("имя без расширения — по типу", [greenFileName("file", "image/jpeg"), greenFileName("", "application/pdf")], ["file.jpg", "file.pdf"]);
check("подпись WhatsApp — 1024", MAX_CAPTION, 1024);

console.log("\nСсылка на файл");
const sig = signFileId("F-260928-ABCDE");
check("подпись сходится", fileSignatureOk("F-260928-ABCDE", sig), true);
check("чужой файл — не сходится", fileSignatureOk("F-260928-ZZZZZ", sig), false);
check("без подписи — нет", fileSignatureOk("F-260928-ABCDE", null), false);
check("имя файла без кириллицы и пробелов", safeFileName("Прайс роза 28.09.pdf"), "28.09.pdf");
check("пустое имя", safeFileName("Прайс"), "file");
check("ссылка", publicFileUrl("https://x.kz/", "F-1", "a b.jpg").startsWith("https://x.kz/api/wa-files/F-1/a_b.jpg?t="), true);

console.log("\nИтог рассылки");
{
  const sent = "2026-09-28T10:00:00.000Z";
  const mk = (phone: string, kind: string, refId: string, state: string) => ({
    broadcastId: "B1", phone, name: `N${phone.slice(-2)}`, kind, refId, managerEmail: "", status: "sent", messageId: `m${phone}`,
    sentAt: sent, error: "", state: state as "replied", replyText: "", replyAt: "",
  });
  const vs = [mk("77010000001", "client", "C1", "replied"), mk("77010000002", "lead", "L2", "read"), mk("77010000003", "client", "C3", "delivered"), { ...mk("77010000004", "client", "C4", "queued"), sentAt: "" }];
  const ord = (orderId: string, clientId: string, createdAt: string, amount: number, status = "new"): OrderLite => ({ orderId, clientId, clientName: clientId, createdAt, status, amount });
  const orders = [
    ord("O1", "C1", "2026-09-29T08:00:00.000Z", 100000),
    ord("O2", "C1", "2026-09-27T08:00:00.000Z", 50000), // до рассылки — нет
    ord("O3", "CL2", "2026-10-01T08:00:00.000Z", 70000), // лид, ставший клиентом
    ord("O4", "C3", "2026-10-09T08:00:00.000Z", 30000), // позже 7 дней — нет
    ord("O5", "C3", "2026-09-30T08:00:00.000Z", 40000, "cancelled"), // отменена — нет
    ord("O6", "C4", "2026-09-29T08:00:00.000Z", 90000), // ему ещё не отправили — нет
  ];
  const res = ordersAfterBroadcast(vs, orders, new Map([["L2", "CL2"]]));
  check("заявки после рассылки", [res.count, res.amount, res.buyers, res.orders.map((o) => o.orderId)], [2, 170000, 2, ["O3", "O1"]]);
  check("по номеру", res.byPhone.get("7010000001"), { count: 1, amount: 100000 });

  const msgs: WaMessage[] = [
    { messageId: "a", at: "2026-09-28T09:00:00.000Z", chatId: "", phone: "77010000001", direction: "in", type: "text", text: "старое", mediaUrl: "", senderName: "", source: "webhook" },
    { messageId: "b", at: "2026-09-28T10:05:00.000Z", chatId: "", phone: "77010000001", direction: "in", type: "text", text: "Когда будет высшая?", mediaUrl: "", senderName: "", source: "webhook" },
    { messageId: "c", at: "2026-09-28T10:06:00.000Z", chatId: "", phone: "77010000001", direction: "out", type: "text", text: "В четверг", mediaUrl: "", senderName: "", source: "webhook" },
  ];
  const tr = broadcastTranscript("Здравствуйте, {имя}!", [vs[0]], msgs);
  check("переписка — только после отправки", [tr.phones, tr.text.includes("старое"), tr.text.includes("Когда будет высшая?"), tr.text.includes("Мы: В четверг")], [["77010000001"], false, true, true]);

  const parsed = parseBroadcastAnalysis(
    {
      summary: "Треть ответила.",
      people: [
        { phone: "+7 701 000 00 01", kind: "order", note: "хочет высшую", callFirst: true },
        { phone: "77099999999", kind: "order", note: "чужой номер", callFirst: true },
        { phone: "77010000001", kind: "other", note: "повтор", callFirst: false },
        { phone: "77010000002", kind: "stop", note: "отписалась", callFirst: true },
      ],
      questions: ["Когда высшая?"],
      objections: [],
      advice: ["Писать цену за стебль"],
    },
    ["77010000001", "77010000002"]
  );
  check("разбор: чужие номера и повторы отброшены", parsed.people.map((p) => [p.phone, p.kind, p.callFirst]), [
    ["77010000001", "order", true],
    ["77010000002", "stop", false],
  ]);
  check("разбор: счётчики", kindCounts(parsed).map((k) => [k.kind, k.count]), [["order", 1], ["stop", 1]]);
  check("незнакомый вид — «другое»", parseBroadcastAnalysis({ people: [{ phone: "77010000001", kind: "wow" }] }, ["77010000001"]).people[0].kind, "other");
  check("мусор — пустой разбор", parseBroadcastAnalysis(null, []), { summary: "", people: [], questions: [], objections: [], advice: [] });
  check("разбор устарел", [analysisIsStale(5, null), analysisIsStale(5, 5), analysisIsStale(6, 5), analysisIsStale(0, null)], [true, false, true, false]);
}

console.log("\nЦены в тексте рассылки");
{
  // Как живой прайс хризантемы: 9 сортов одной ценой, Altaj — своя, общей «Все сорта» нет.
  const pr: Record<string, number> = {};
  const grades = ["Высшая", "Первая", "Вторая", "Третья", "Четвёртая", "Мини-микс"];
  const common = [490, 460, 430, 220, 120, 90];
  for (const v of ["Bacardy", "Топспин", "Ассортимент"]) grades.forEach((g, i) => (pr[`chrysanthemum|${v}|${g}`] = common[i]));
  [580, 530, 400, 300, 200, 180].forEach((p, i) => (pr[`chrysanthemum|Altaj|${grades[i]}`] = p));
  const block = priceBlock("chrysanthemum", pr).replace(/[\u00a0\u202f]/g, " ");
  check("основная цена — строкой на категорию, по порядку", block.split("\n").slice(0, 3), ["• Высшая — 490 ₸", "• Первая — 460 ₸", "• Вторая — 430 ₸"]);
  check("особый сорт — своей строкой", block.split("\n").pop(), "• Altaj: Высшая 580 · Первая 530 · Вторая 400 · Третья 300 · Четвёртая 200 · Мини-микс 180 ₸");
  // Эустома живёт по общей цене «Все сорта»; сорт без своей цены — в общей строке.
  const eu: Record<string, number> = { "eustoma||Стандарт": 400, "eustoma||50": 150 };
  check("общая цена «Все сорта»", priceBlock("eustoma", eu).replace(/[\u00a0\u202f]/g, " "), "• Стандарт — 400 ₸\n• 50 см — 150 ₸");
  check("нет цен — пустой блок", priceBlock("rose", pr), "");
  check("метка заменяется, регистр и форма слова не важны", fillPrices("Цены:\n{Цены хризантемы}\nЖдём!", pr).includes("{"), false);
  check("метка эустомы подставилась", fillPrices("{цены эустома}", eu).replace(/[\u00a0\u202f]/g, " "), "• Стандарт — 400 ₸\n• 50 см — 150 ₸");
  check("какие цветы в метках", priceTagFlowers("{цены хризантема} и {цены роза} и {цены тюльпан}"), ["chrysanthemum", "rose", "?тюльпан"]);
  check("отказ: незнакомая метка", priceTagsRefusal("{цены тюльпан}", pr).startsWith("Не понял метку"), true);
  check("отказ: в прайсе нет розы", priceTagsRefusal("{цены роза}", pr), "В прайсе нет цен на розу — заполните прайс или уберите метку");
  check("без меток — без отказа", priceTagsRefusal("Здравствуйте, {имя}!", {}), "");
  check("{имя} метки цен не трогают", fillPrices("Здравствуйте, {имя}!", pr), "Здравствуйте, {имя}!");
  check(
    "один сорт: {цены хризантема Altaj}",
    fillPrices("Цены:\n{цены хризантема altaj}", pr).replace(/[\u00a0\u202f]/g, " "),
    "Цены:\n• Высшая — 580 ₸\n• Первая — 530 ₸\n• Вторая — 400 ₸\n• Третья — 300 ₸\n• Четвёртая — 200 ₸\n• Мини-микс — 180 ₸"
  );
  check("сорт без своей цены берёт общую", fillPrices("{цены эустома Alissa}", { ...eu, "eustoma|Alissa|50": 170 }).replace(/[\u00a0\u202f]/g, " "), "• Стандарт — 400 ₸\n• 50 см — 170 ₸");
  check("отказ: сорта нет в прайсе", priceTagsRefusal("{цены хризантема Алтай}", pr), "В прайсе нет цен на сорт «Алтай» — проверьте написание, как в прайсе");
  check("с сортом — без отказа", priceTagsRefusal("{цены хризантема Altaj}", pr), "");
  const opts = priceTagOptions(pr);
  check("список вставки: сначала весь цветок, Altaj есть", [opts[0].tag, opts.some((o) => o.tag === "{цены хризантема Altaj}")], ["{цены хризантема}", true]);
  check("список вставки: цветка без цен нет", opts.some((o) => o.flower === "rose"), false);
  check("вставка — с новой строки", insertTag("Здравствуйте, {имя}! ", "{цены хризантема Altaj}"), "Здравствуйте, {имя}!\n{цены хризантема Altaj}\n");
  check("вставка после переноса строки — без лишней пустой", insertTag("Цены:\n", "{цены роза}"), "Цены:\n{цены роза}\n");
}


{
  console.log("\nЧто бот знает сам: склад и последняя рассылка");
  const settings = { shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 }, warningThreshold: 0.7 };
  const now = new Date("2026-10-01T06:00:00Z");
  const batch = (id: string, flowerType: string, variety: string, grade: string, qty: number, harvestDate: string) => ({
    batchId: id, receivedAt: harvestDate, harvestDate, flowerType: flowerType as "rose", variety, grade,
    quantityIn: qty, quantityRemaining: qty, location: "", receivedByEmail: "",
  });
  const stock = stockForBot(
    [
      batch("b1", "chrysanthemum", "Altaj", "Высшая", 1200, "2026-09-29"),
      batch("b2", "chrysanthemum", "Altaj", "Высшая", 450, "2026-09-30"),
      batch("b3", "rose", "Red Naomi", "60", 800, "2026-09-30"),
      batch("b4", "rose", "Red Naomi", "60", 5000, "2026-09-10"),
      batch("b5", "eustoma", "Mix", "Стандарт", 40, "2026-09-30"),
      batch("b6", "rose", "Avalanche", "50", 0, "2026-09-30"),
    ],
    settings,
    now
  );
  check("склад: просроченное и пустое не предлагаем, партии складываются", stock.split("\n"), [
    "Роза · Red Naomi · 60 см — около 800 шт.",
    "Хризантема · Altaj · Высшая — около 1 500 шт.",
    "Эустома · Mix · Стандарт — мало, до 100 шт.",
  ]);
  check("округление вниз", [roughStems(99), roughStems(150), roughStems(1999), roughStems(12345)], [
    "мало, до 100 шт.",
    "около 100 шт.",
    "около 1 500 шт.",
    "около 12 000 шт.",
  ]);
  check(
    "последняя рассылка — по дню запуска, без {имя}",
    lastBroadcastForBot([
      { title: "Акция хризантемы", text: "Здравствуйте, {имя}! Старое", startedAt: "2026-09-28T10:00:00Z", createdAt: "" },
      { title: "Хризантема Алтай", text: "Здравствуйте, {имя}!\nАлтай высшая 580 ₸", startedAt: "2026-10-01T05:00:00Z", createdAt: "" },
      { title: "Черновик", text: "не ушла", startedAt: "", createdAt: "2026-10-01T06:00:00Z" },
    ]),
    "«Хризантема Алтай», отправлена 2026-10-01:\nЗдравствуйте, !\nАлтай высшая 580 ₸"
  );
  check("рассылок не было — пусто", lastBroadcastForBot([]), "");
  const bl = [
    { broadcastId: "b-akc", title: "Акция хризантемы", text: "Акция", startedAt: "2026-09-28T10:00:00Z", createdAt: "" },
    { broadcastId: "b-alt", title: "Алтай", text: "Алтай 580", startedAt: "2026-10-01T05:00:00Z", createdAt: "" },
    { broadcastId: "b-test", title: "Тестовая", text: "проверка", startedAt: "2026-10-01T06:00:00Z", createdAt: "" },
  ];
  const sent = (id: string, phone: string, at: string) => ({ broadcastId: id, phone, status: "sent", sentAt: at });
  const rcp = [
    sent("b-akc", "77011110001", "2026-09-28T10:01:00Z"),
    sent("b-akc", "77011110002", "2026-09-28T10:02:00Z"),
    sent("b-akc", "77011110003", "2026-09-28T10:03:00Z"),
    sent("b-alt", "77011110002", "2026-10-01T05:01:00Z"),
    sent("b-alt", "77011110004", "2026-10-01T05:02:00Z"),
    sent("b-alt", "77011110005", "2026-10-01T05:03:00Z"),
    sent("b-test", "77019998877", "2026-10-01T06:01:00Z"),
  ];
  check("рассылка — та, что ушла этому клиенту последней", lastBroadcastForBot(bl, rcp, "+7 701 111 00 02").split("\n")[0], "«Алтай», отправлена 2026-10-01:");
  check("клиент получал только старую — старая", lastBroadcastForBot(bl, rcp, "87011110001").split("\n")[0], "«Акция хризантемы», отправлена 2026-09-28:");
  check("номер не из рассылок — последняя настоящая, не проверочная", lastBroadcastForBot(bl, rcp, "77770000000").split("\n")[0], "«Алтай», отправлена 2026-10-01:");

  const pr = (flowerType: string, variety: string, grade: string, price: number) => ({ flowerType, variety, grade, price });
  check(
    "прайс для бота: у сорта свои цены, сорта с одной ценой — одной строкой, остальные — по общей",
    pricesForBot([
      pr("chrysanthemum", "", "Высшая", 490),
      pr("chrysanthemum", "", "Третья", 250),
      pr("chrysanthemum", "Altaj", "Высшая", 580),
      pr("chrysanthemum", "Altaj", "Третья", 270),
      pr("chrysanthemum", "Baltika", "Высшая", 490),
      pr("rose", "Avalanche", "60", 180),
      pr("rose", "Red Naomi", "60", 180),
      pr("rose", "", "60", 0),
    ]).split("\n"),
    [
      "Роза Avalanche, Red Naomi: 60 см 180 ₸",
      "Хризантема Altaj: Высшая 580 · Третья 270 ₸",
      "Хризантема Baltika, остальные сорта: Высшая 490 · Третья 250 ₸",
    ]
  );
}

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
