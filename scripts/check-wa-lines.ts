/**
 * Проверка номеров WhatsApp менеджеров и ИИ-помощника (16.10.2026): код линии, форма подключения,
 * шифр токена, когда помощник отвечает сам, список переписок, авто-лид с номера менеджера, решения ИИ
 * по менеджерам, темп рассылки с номера менеджера.
 *   npx tsx scripts/check-wa-lines.ts
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "check-secret";
import { assistantVerdict, buildChatList, genitiveName, isWorkTime, lineCodeFor, lineInputRefusal, parseAssistantMode } from "../src/lib/waLines";
import { BOT_CHANNEL, isAssistantOrder, isChannelOrder, lineChannel, orderNoteHead } from "../src/lib/sellerChannel";
import { lineAlertText, lineBotChat, lineMorningPlanText, lineNudgeStatus } from "../src/lib/lineSellerRules";
import { systemPrompt } from "../src/lib/botEngine";
import { BOT_MANAGER_EMAIL } from "../src/lib/botIdentity";
import { openSecret, sealSecret } from "../src/lib/secretBox";
import { parseAssistantAnswer, assistantTranscript } from "../src/lib/lineAssistant";
import { autoLeadFromMessage } from "../src/lib/waAutoLead";
import { decisionScope } from "../src/lib/leadDecisions";
import { MANAGER_PACE, MAIN_PACE, LEADS_PACE, paceFor } from "../src/lib/broadcast";
import type { Lead, LeadAnalysis, WaMessage } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

// --- Код линии, форма, имя ---------------------------------------------------------
check("код из почты", lineCodeFor("Ilyas.K@gmail.com", []), "m-ilyask");
check("код занят — с цифрой", lineCodeFor("ilyas@x.kz", ["m-ilyas"]), "m-ilyas2");
check("форма: нужен менеджер", lineInputRefusal({ managerEmail: "", instance: "1103", token: "x", url: "" }, false), "Выберите менеджера");
check("форма: idInstance — цифры", lineInputRefusal({ managerEmail: "a@b", instance: "abc", token: "x".repeat(40), url: "" }, false).startsWith("idInstance"), true);
check("форма: короткий токен", lineInputRefusal({ managerEmail: "a@b", instance: "1103123456", token: "abc", url: "" }, false).startsWith("Вставьте"), true);
check("форма: замена без токена — можно", lineInputRefusal({ managerEmail: "a@b", instance: "1103123456", token: "", url: "" }, true), "");
check("форма: кривой apiUrl", lineInputRefusal({ managerEmail: "a@b", instance: "1103123456", token: "x".repeat(40), url: "http://x" }, false).startsWith("apiUrl"), true);
check("родительный падеж", ["Ильяс", "Эмиль", "Ильгар", "Земфира", "Динара Алиева"].map(genitiveName), ["Ильяса", "Эмиля", "Ильгара", "Земфиры", "Динары"]);

// --- Шифр токена -----------------------------------------------------------------------
const sealed = sealSecret("secret-token-123");
check("шифр: не виден в ячейке", sealed.includes("secret-token"), false);
check("шифр: расшифровывается", openSecret(sealed), "secret-token-123");
check("шифр: испорченная ячейка — пусто", openSecret(sealed.slice(0, -4) + "AAAA"), "");
check("шифр: пусто — пусто", openSecret(""), "");

// --- Когда помощник отвечает сам ---------------------------------------------------------
const M = (id: string, at: string, direction: "in" | "out", text = "Сколько стоит хризантема?"): WaMessage => ({
  messageId: id, at, chatId: "", phone: "77010000001", direction, type: "text", text, mediaUrl: "", senderName: "", source: "", line: "m-ilyas",
});
// Пятница 16.10.2026, 12:00 по Алматы = 07:00Z — рабочее время.
const fri12 = new Date("2026-10-16T07:00:00Z");
check("пятница 12:00 — рабочее", isWorkTime(fri12), true);
check("воскресенье — нерабочее", isWorkTime(new Date("2026-10-18T07:00:00Z")), false);
check("пятница 20:00 — нерабочее", isWorkTime(new Date("2026-10-16T15:00:00Z")), false);
const base = [M("1", "2026-10-16T06:00:00Z", "out", "Здравствуйте"), M("2", "2026-10-16T06:30:00Z", "in")];
const v = (chat: WaMessage[], now: Date, extra: Partial<Parameters<typeof assistantVerdict>[0]> = {}) =>
  assistantVerdict({ chat, autoIds: new Set(), now, mode: "on", ...extra });
check("днём ждёт 30 мин — отвечает", v(base, fri12).due, true);
check("днём ждёт 10 мин — нет", v(base, new Date("2026-10-16T06:40:00Z")).due, false);
check("режим «только подсказывает» — нет", v(base, fri12, { mode: "off" }).due, false);
check("последним писали мы — нет", v([...base, M("3", "2026-10-16T06:45:00Z", "out", "Сейчас скажу")], fri12).reason, "последним писали мы");
check("кивок — нет", v([M("1", "2026-10-16T06:00:00Z", "out"), M("2", "2026-10-16T06:30:00Z", "in", "ок")], fri12).reason, "клиент просто кивнул");
check("сотрудник — нет", v(base, fri12, { staff: true }).due, false);
check("давнее (13 ч) — нет", v(base, new Date("2026-10-16T19:40:00Z")).due, false);
// Суббота 22:00 по Алматы = 17:00Z: нерабочее, но писать можно.
const late = [M("1", "2026-10-17T16:50:00Z", "out", "Добрый вечер"), M("2", "2026-10-17T16:57:00Z", "in")];
check("вечером через 3 мин — отвечает", v(late, new Date("2026-10-17T17:00:00Z")).due, true);
check("вечером через 1 мин — ждём серию", v(late, new Date("2026-10-17T16:58:00Z")).due, false);
check("вечером из вебхука через 30 с — отвечает", v(late, new Date("2026-10-17T16:57:30Z"), { quick: true }).due, true);
// Ночь: 02:00 по Алматы = 21:00Z.
check("ночью — нет", v([M("1", "2026-10-16T20:00:00Z", "out"), M("2", "2026-10-16T20:30:00Z", "in")], new Date("2026-10-16T21:00:00Z")).reason, "ночь — ответит утром");
const threeAi = [
  M("a1", "2026-10-16T05:00:00Z", "in"), M("a2", "2026-10-16T05:30:00Z", "out", "ИИ 1"),
  M("a3", "2026-10-16T05:35:00Z", "in"), M("a4", "2026-10-16T05:58:00Z", "out", "ИИ 2"),
  M("a5", "2026-10-16T06:00:00Z", "in"), M("a6", "2026-10-16T06:25:00Z", "out", "ИИ 3"),
  M("a7", "2026-10-16T06:30:00Z", "in"),
];
check("три ответа ИИ подряд — ждёт менеджера", v(threeAi, fri12, { autoIds: new Set(["a2", "a4", "a6"]) }).due, false);
check("менеджер ответил между — снова можно", v(threeAi, fri12, { autoIds: new Set(["a2", "a6"]) }).due, true);
check("автоответ магазина — нет", v([M("1", "2026-10-16T06:00:00Z", "out"), M("2", "2026-10-16T06:01:00Z", "in", "Спасибо за обращение! Ответим в ближайшее время.")], fri12).reason, "похоже на автоответ");

// --- Ответ модели и переписка для неё -----------------------------------------------------
check("ответ: молчать", parseAssistantAnswer({ reply: "x", silent: true, needs_manager: "" }), { reply: "", silent: true, note: "" });
check("ответ: **жирный** → *жирный*", parseAssistantAnswer({ reply: "Цена **270 ₸**", silent: false, needs_manager: "оформить заказ" }), { reply: "Цена *270 ₸*", silent: false, note: "оформить заказ" });
check("ответ: пустой — молчать", parseAssistantAnswer({ reply: " ", silent: false, needs_manager: "" }).silent, true);
check("переписка: клиент и мы", assistantTranscript(base).split("\n").map((l) => l.replace(/^\[[^\]]*\] /, "")), ["Мы: Здравствуйте", "Клиент: Сколько стоит хризантема?"]);

// --- Список переписок ------------------------------------------------------------------
const list = buildChatList({
  messages: [...base, { ...M("9", "2026-10-15T06:00:00Z", "in"), phone: "77010000002", line: "m-ilyas" }, { ...M("8", "2026-10-16T06:00:00Z", "in"), phone: "77010000003", line: "leads" }],
  line: "m-ilyas",
  parties: new Map([["7010000001", { kind: "lead" as const, id: "L1", name: "Цветы Достык", managerEmail: "i@x" }]]),
  autoIds: new Set(),
});
check("переписки линии: только её, свежие сверху", list.map((c) => c.name), ["Цветы Достык", "+77010000002"]);
check("ждёт ответа — с первого сообщения серии", list[0].waitingSince, "2026-10-16T06:30:00Z");

// --- Авто-лид с номера менеджера --------------------------------------------------------
const inc = { direction: "in" as const, phone: "77015550001", senderName: "Айгуль", type: "text", text: "Здравствуйте, почём роза?", at: "2026-10-16T06:00:00Z" };
const lineOpts = { whose: "Ильяса", origin: "", incomingOnly: true };
const lead = autoLeadFromMessage(inc, new Set(), "ilyas@x", "2026-10-16", lineOpts);
check("авто-лид менеджера: его, не «с рекламы»", [lead?.managerEmail, lead?.origin, lead?.source], ["ilyas@x", "", "Написали в WhatsApp"]);
check("авто-лид менеджера: в заметке чей номер", lead?.note.startsWith("Сам написал в WhatsApp Ильяса 2026-10-16"), true);
check("авто-лид менеджера: его исходящее — не лид", autoLeadFromMessage({ ...inc, direction: "out" }, new Set(), "ilyas@x", "2026-10-16", lineOpts), null);
check("авто-лид Земфиры: исходящее — по-прежнему лид", autoLeadFromMessage({ ...inc, direction: "out" }, new Set(), "z@x", "2026-10-16")?.origin, "ads");
check("знакомый номер — не лид", autoLeadFromMessage(inc, new Set(["7015550001"]), "ilyas@x", "2026-10-16", lineOpts), null);

// --- Решения ИИ по менеджерам ------------------------------------------------------------
const L = (id: string, phone: string, extra: Partial<Lead> = {}): Lead => ({
  leadId: id, createdAt: "", createdByEmail: "", name: id, city: "", contactPerson: "", phone, clientType: "", source: "", address: "", note: "",
  managerEmail: "i@x", stage: "contact", stageChangedAt: "", nextTouchAt: "", lostReason: "", clientId: "", campaign: "", segment: "", history: "",
  firstSeenAt: "", pastOrders: 0, origin: "", handedOverAt: "", handedOverBy: "", ...extra,
});
const leads = [L("chat", "77010000001"), L("base", "77010000009", { campaign: "Обзвон" }), L("ads", "77010000005", { origin: "ads", managerEmail: "z@x", createdByEmail: "z@x" }), L("other", "77010000002", { managerEmail: "e@x" })];
const msgs = [M("1", "2026-10-16T06:00:00Z", "in"), { ...M("2", "2026-10-16T06:00:00Z", "in"), phone: "77010000002" }];
const scope = (role: string, email: string, manager = "") => decisionScope({ role, email, leads, messages: msgs, analyses: [] as LeadAnalysis[], manager }).map((l) => l.leadId);
check("решения: менеджер — свои с перепиской", scope("manager", "i@x"), ["chat"]);
check("решения: владелец — с перепиской и с рекламы", scope("admin", "o@x"), ["chat", "ads", "other"]);
check("решения: владелец, отбор по менеджеру", scope("admin", "o@x", "e@x"), ["other"]);
check("решения: Земфира — свои с рекламы", scope("leadgen", "z@x"), ["ads"]);

// --- Темп рассылки ------------------------------------------------------------------------
check("темп: номер менеджера — осторожный", [paceFor("m-ilyas") === MANAGER_PACE, paceFor("leads") === LEADS_PACE, paceFor("") === MAIN_PACE], [true, true, true]);
check("темп менеджера: до 20 в час", MANAGER_PACE.hourly, 20);

// --- Продающий помощник (режим «sell», 19.10.2026) ---------------------------------------
check("режим из ячейки", ["sell", "off", "", "on", "x"].map(parseAssistantMode), ["sell", "off", "on", "on", "on"]);
const sv = (chat: WaMessage[], now: Date, extra: Partial<Parameters<typeof assistantVerdict>[0]> = {}) =>
  assistantVerdict({ chat, autoIds: new Set(), now, mode: "sell", ...extra });
check("продаёт: днём ждёт 6 мин — отвечает", sv(base, new Date("2026-10-16T06:36:00Z")).due, true);
const early = sv(base, new Date("2026-10-16T06:33:00Z"));
check("продаёт: ждёт 3 мин — нет, проверить через ~2 мин", [early.due, Math.round((early.retryInMs ?? 0) / 1000)], [false, 122]);
check("«подсказывает»: 6 мин — ещё нет (20 мин)", v(base, new Date("2026-10-16T06:36:00Z")).due, false);
const aiTalk = [M("t1", "2026-10-16T06:00:00Z", "in"), M("t2", "2026-10-16T06:05:00Z", "out", "Altaj 3 кат — 270 ₸"), M("t3", "2026-10-16T06:10:00Z", "in", "А 4 категория есть?")];
const leadV = sv(aiTalk, new Date("2026-10-16T06:10:30Z"), { autoIds: new Set(["t2"]) });
check("ИИ ведёт разговор — отвечает после серии, без 5 минут", [leadV.due, leadV.reason], [true, "ИИ ведёт разговор"]);
const humanMid = [...aiTalk.slice(0, 2), M("t2b", "2026-10-16T06:07:00Z", "out", "Сейчас уточню"), aiTalk[2]];
check("менеджер вмешался — снова ждём его 5 минут", sv(humanMid, new Date("2026-10-16T06:10:30Z"), { autoIds: new Set(["t2"]) }).due, false);
check("продаёт: 4 ответа ИИ подряд — ещё отвечает (предел 12)", sv([...threeAi], fri12, { autoIds: new Set(["a2", "a4", "a6"]) }).due, true);
check("продаёт: ночью — нет", sv([M("1", "2026-10-16T20:00:00Z", "out"), M("2", "2026-10-16T20:30:00Z", "in")], new Date("2026-10-16T21:00:00Z")).due, false);

const ilyas = lineChannel({ code: "m-ilyas", managerEmail: "Ilyas@X.kz" }, "Ильяс Каримов");
check("канал номера: почта и имя", [ilyas.managerEmail, ilyas.managerName, ilyas.line], ["ilyas@x.kz", "Ильяс", "m-ilyas"]);
check("заметка заявки помощника", orderNoteHead(ilyas), "Заказ оформил ИИ-помощник Ильяса в WhatsApp.");
check("заметка заявки бота — как раньше", orderNoteHead(BOT_CHANNEL), "Заказ принял бот WhatsApp.");
check("заказ помощника — его", isChannelOrder({ managerEmail: "ilyas@x.kz", notes: "Заказ оформил ИИ-помощник Ильяса в WhatsApp. Адрес: …" }, ilyas), true);
check("заказ Ильяса руками — не помощника", isChannelOrder({ managerEmail: "ilyas@x.kz", notes: "Как в прошлый раз" }, ilyas), false);
check("заказ бота — не помощника Ильяса", isChannelOrder({ managerEmail: BOT_MANAGER_EMAIL, notes: "Заказ принял бот WhatsApp." }, ilyas), false);
check("заказ бота — бота", isChannelOrder({ managerEmail: BOT_MANAGER_EMAIL, notes: "" }, BOT_CHANNEL), true);
check("метка помощника в заметке", [isAssistantOrder({ notes: orderNoteHead(ilyas) }), isAssistantOrder({ notes: "" })], [true, false]);

const mem = lineBotChat("+7 701 000 00 01", [
  { ...M("c1", "2026-10-16T06:00:00Z", "in", "Почём Altaj?"), senderName: "Айгуль" },
  M("c2", "2026-10-16T06:02:00Z", "out", "Третья — 270 ₸"),
]);
check("память из переписки номера", [mem.phone, mem.name, mem.context.map((c) => c.role)], ["77010000001", "Айгуль", ["client", "us"]]);

const persona = systemPrompt({ instructions: "", prices: "", stock: "", broadcast: "", client: "", today: "2026-10-19", managerName: "Ильяс" });
const botP = systemPrompt({ instructions: "", prices: "", stock: "", broadcast: "", client: "", today: "2026-10-19" });
check("подсказка помощника: от имени Ильяса, в мужском роде", [persona.startsWith("Ты — Ильяс, менеджер"), persona.includes("передала"), persona.includes("наберу вас")], [true, false, true]);
check("подсказка помощника: не клиент (семья, водитель, коллега) — молчать", persona.includes("silent=true, если собеседник — не покупатель цветов"), true);
check("подсказка бота — прежняя", [botP.startsWith("Ты — сильный продавец"), botP.includes("передала руководителю")], [true, true]);

const N = (id: string, at: string, d: "in" | "out", text = "Почём хризантема?") => M(id, at, d, text);
const talk = [N("n1", "2026-10-16T05:00:00Z", "in"), N("n2", "2026-10-16T05:10:00Z", "out", "Altaj 3 кат — 270 ₸, сколько поставить?")];
const ns = (now: string, extra: Partial<Parameters<typeof lineNudgeStatus>[0]> = {}) =>
  lineNudgeStatus({ chat: talk, nudges: [], now: new Date(now), hour: 13, ...extra });
check("дожим: через 3 ч после нас — первое касание", ns("2026-10-16T08:20:00Z").attempt, 1);
check("дожим: через 2 ч — рано", ns("2026-10-16T07:10:00Z").attempt, 0);
check("дожим: назавтра — второе", ns("2026-10-17T05:00:00Z", { nudges: [{ at: "2026-10-16T08:20:00Z", closed: false }] }).attempt, 2);
check("дожим: два было — хватит", ns("2026-10-18T06:00:00Z", { nudges: [{ at: "2026-10-16T08:20:00Z", closed: false }, { at: "2026-10-17T05:00:00Z", closed: false }] }).attempt, 0);
check("дожим: модель сказала «не писать»", ns("2026-10-16T08:20:00Z", { nudges: [{ at: "2026-10-16T08:00:00Z", closed: true }] }).reason, "дожим закрыт: модель решила не писать");
check("дожим: заказ оформлен — не надо", ns("2026-10-16T08:20:00Z", { orderAt: ["2026-10-16T05:30:00Z"] }).reason, "заказ уже оформлен");
check("дожим: клиент не отвечал (рассылка) — нет", lineNudgeStatus({ chat: [talk[1]], nudges: [], now: new Date("2026-10-16T09:00:00Z"), hour: 13 }).attempt, 0);
check("дожим: вечером — нет", ns("2026-10-16T16:00:00Z", { hour: 21 }).attempt, 0);
check("дожим: сотрудник — нет", ns("2026-10-16T08:20:00Z", { staff: true }).attempt, 0);
check("дожим: клиент последним — ждёт ответа", lineNudgeStatus({ chat: [...talk, N("n3", "2026-10-16T05:20:00Z", "in", "А 4?")], nudges: [], now: new Date("2026-10-16T09:00:00Z"), hour: 13 }).attempt, 0);

const plan = lineMorningPlanText({
  managerName: "Ильяс",
  now: new Date("2026-10-19T04:00:00Z"),
  waiting: [{ name: "Цветы Достык", phone: "77010000001", text: "Есть 4 категория?", sinceIso: "2026-10-18T14:00:00Z" }],
  yesterday: { replies: 7, chats: 3, orders: [{ code: "AB12C", amount: 54000, paid: true }] },
  nudgeToday: 2,
  sleeping: [{ name: "Магнолия", phone: "77010000002", days: 12, usual: "Хризантема Altaj, Третья" }],
  openNotes: ["…0001: просит отсрочку"],
  link: "https://www.crm-ecoculture.kz/clients/chats?line=m-ilyas",
});
check("план: все блоки", ["Доброе утро, Ильяс!", "Ждут ответа: 1", "Помощник просит сделать: 1", "Оформил заказов: 1 на *54 000 ₸* — №AB12C ✓", "напомнит о себе 2", "Давно не заказывали: 1"].map((x) => plan.includes(x)), [true, true, true, true, true, true]);
check("план: нечего сказать — не отправлять", lineMorningPlanText({ managerName: "", now: new Date(), waiting: [], yesterday: { replies: 0, chats: 0, orders: [] }, nudgeToday: 0, sleeping: [], openNotes: [], link: "x" }), "");
check("тревога менеджеру", lineAlertText({ phone: "77010000001", name: "Айгуль", note: "внимание: просит оплату при получении", lastClient: "Можно наличными при доставке?" }).split("\n"), [
  "⚠️ *Помощник просит вас*",
  "Айгуль, +77010000001",
  "просит оплату при получении",
  "Клиент: «Можно наличными при доставке?»",
]);

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
