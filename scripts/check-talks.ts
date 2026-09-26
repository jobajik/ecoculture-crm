/*
 * Проверка переписки WhatsApp и её разбора ИИ (`src/lib/whatsapp.ts`,
 * `src/lib/talkAnalysis.ts`, `src/lib/greenApi.ts`): разбор уведомлений Green API,
 * склейка повторов, скорость ответа, «ждёт ответа», новые обращения, проверка
 * ответа модели, балл по чек-листу, заполнение касания и отчёт РОПу.
 * Запуск: npx tsx scripts/check-talks.ts
 */
import {
  buildInbox,
  chatPhone,
  mergeMessages,
  messageText,
  messagesForPhone,
  minutesWords,
  parseGreenWebhook,
  parseHistoryItem,
  replyStats,
  transcriptForAi,
} from "../src/lib/whatsapp";
import {
  ANALYSIS_SCHEMA,
  CHECKLIST_KEYS,
  buildPrompt,
  buildTalkReport,
  newSinceAnalysis,
  parseAnalysis,
  scoreOf,
  talkInfoByLead,
  touchPrefill,
} from "../src/lib/talkAnalysis";
import { chatIdForPhone, webhookTokenOk } from "../src/lib/greenApi";
import type { Lead, LeadAnalysis, WaMessage } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

const TS = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const hook = (typeWebhook: string, messageData: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  typeWebhook,
  instanceData: { idInstance: 1101, wid: "77770000000@c.us", typeInstance: "whatsapp" },
  timestamp: TS("2026-09-25T10:00:00Z"),
  idMessage: "ABC123",
  senderData: { chatId: "77015552030@c.us", sender: "77015552030@c.us", chatName: "Айгуль", senderName: "Айгуль", senderContactName: "" },
  messageData,
  ...extra,
});

// --- Номер и уведомления --------------------------------------------------------
check("номер из chatId", chatPhone("77015552030@c.us"), "77015552030");
check("группа — не наш разговор", chatPhone("120363043968066561@g.us"), "");
check("скрытый номер (lid) — не узнаём", chatPhone("12345678901234@lid"), "");
check("chatId из 8-ки", chatIdForPhone("8 701 555 20 30"), "77015552030@c.us");
check("chatId из +7", chatIdForPhone("+7 701 555 20 30"), "77015552030@c.us");
check("короткий номер — нет chatId", chatIdForPhone("12-34"), "");

const txt = parseGreenWebhook(hook("incomingMessageReceived", { typeMessage: "textMessage", textMessageData: { textMessage: "Сколько роза 60?" } }));
check("входящий текст", [txt?.direction, txt?.type, txt?.text, txt?.phone, txt?.senderName, txt?.source], ["in", "text", "Сколько роза 60?", "77015552030", "Айгуль", "webhook"]);
check("время из timestamp", txt?.at, "2026-09-25T10:00:00.000Z");
const out = parseGreenWebhook(hook("outgoingMessageReceived", { typeMessage: "extendedTextMessage", extendedTextMessageData: { text: "Прайс во вложении" } }));
check("ответ с телефона — наш, без имени", [out?.direction, out?.text, out?.senderName], ["out", "Прайс во вложении", ""]);
const api = parseGreenWebhook(hook("outgoingAPIMessageReceived", { typeMessage: "textMessage", textMessageData: { textMessage: "Счёт" } }));
check("отправленное через API — тоже наше", api?.direction, "out");
const quoted = parseGreenWebhook(hook("incomingMessageReceived", { typeMessage: "quotedMessage", extendedTextMessageData: { text: "Да, беру" } }));
check("ответ с цитатой — текст ответа", quoted?.text, "Да, беру");
const voice = parseGreenWebhook(
  hook("incomingMessageReceived", { typeMessage: "audioMessage", fileMessageData: { downloadUrl: "https://api.green-api.com/f/1.oga", caption: "", mimeType: "audio/ogg" } })
);
check("голосовое — тип и ссылка", [voice?.type, voice?.mediaUrl, voice?.text], ["voice", "https://api.green-api.com/f/1.oga", ""]);
const doc = parseGreenWebhook(
  hook("incomingMessageReceived", { typeMessage: "documentMessage", fileMessageData: { downloadUrl: "https://x/f.pdf", caption: "реквизиты", fileName: "ТОО.pdf" } })
);
check("документ — подпись и имя файла", doc?.text, "реквизиты · ТОО.pdf");
check("статус доставки — не сообщение", parseGreenWebhook({ typeWebhook: "outgoingMessageStatus", status: "read" }), null);
check("реакция — не храним", parseGreenWebhook(hook("incomingMessageReceived", { typeMessage: "reactionMessage" })), null);
check("группа — не храним", parseGreenWebhook(hook("incomingMessageReceived", { typeMessage: "textMessage", textMessageData: { textMessage: "всем" } }, { senderData: { chatId: "1203@g.us" } })), null);
check("без номера сообщения — не храним", parseGreenWebhook(hook("incomingMessageReceived", { typeMessage: "textMessage", textMessageData: { textMessage: "x" } }, { idMessage: "" })), null);
check("мусор — null", parseGreenWebhook("hello"), null);
const long = parseGreenWebhook(hook("incomingMessageReceived", { typeMessage: "textMessage", textMessageData: { textMessage: "а".repeat(9000) } }));
check("длинный текст обрезается до предела ячейки", (long?.text.length ?? 0) <= 4001, true);

const hist = parseHistoryItem({ type: "incoming", idMessage: "H1", timestamp: TS("2026-09-20T09:00:00Z"), typeMessage: "textMessage", chatId: "77015552030@c.us", textMessage: "Здравствуйте", senderName: "Айгуль" });
check("история: входящее", [hist?.direction, hist?.text, hist?.source], ["in", "Здравствуйте", "history"]);
const histOut = parseHistoryItem({ type: "outgoing", idMessage: "H2", timestamp: TS("2026-09-20T09:30:00Z"), typeMessage: "extendedTextMessage", chatId: "77015552030@c.us", extendedTextMessage: { text: "Добрый день!" } });
check("история: исходящее со ссылкой", [histOut?.direction, histOut?.text], ["out", "Добрый день!"]);
const histVoice = parseHistoryItem({ type: "incoming", idMessage: "H3", timestamp: TS("2026-09-20T10:00:00Z"), typeMessage: "audioMessage", chatId: "77015552030@c.us", downloadUrl: "https://x/v.oga" });
check("история: голосовое со ссылкой", [histVoice?.type, histVoice?.mediaUrl], ["voice", "https://x/v.oga"]);

// --- Токен вебхука -------------------------------------------------------------
check("токен с Bearer", webhookTokenOk("Bearer s3cret-token", "s3cret-token"), true);
check("голый токен", webhookTokenOk("s3cret-token", "s3cret-token"), true);
check("чужой токен", webhookTokenOk("Bearer s3cret-tokeN", "s3cret-token"), false);
check("нет заголовка", webhookTokenOk(null, "s3cret-token"), false);
check("токен не задан — никого не пускаем", webhookTokenOk("Bearer ", ""), false);

// --- Склейка и скорость ответа ----------------------------------------------------
const m = (id: string, at: string, direction: "in" | "out", text = "x", phone = "77015552030", type = "text"): WaMessage => ({
  messageId: id, at, chatId: `${phone}@c.us`, phone, direction, type, text, mediaUrl: "", senderName: "", source: "webhook",
});
const dup = mergeMessages([m("A", "2026-09-25T10:00:00Z", "in", ""), m("B", "2026-09-25T09:00:00Z", "out"), m("A", "2026-09-25T10:00:00Z", "in", "расшифровка")]);
check("повтор склеен, осталась копия с расшифровкой, по времени", dup.map((x) => `${x.messageId}:${x.text}`), ["B:x", "A:расшифровка"]);
const talk = [
  m("1", "2026-09-25T09:00:00Z", "in"),
  m("2", "2026-09-25T09:05:00Z", "in"),
  m("3", "2026-09-25T09:20:00Z", "out"),
  m("4", "2026-09-25T10:00:00Z", "in"),
  m("5", "2026-09-25T12:00:00Z", "out"),
  m("6", "2026-09-25T13:00:00Z", "in"),
];
const st = replyStats(talk);
check("ответ считается от ПЕРВОГО сообщения серии; медиана", st.replyMinutes, 70);
check("последним писал клиент — ждёт с 13:00", st.waitingSince, "2026-09-25T13:00:00Z");
check("входящих и исходящих", [st.inCount, st.outCount], [4, 2]);
check("мы ответили последними — никто не ждёт", replyStats(talk.slice(0, 5)).waitingSince, null);
check("не на что отвечать — скорости нет", replyStats([m("x", "2026-09-25T09:00:00Z", "out")]).replyMinutes, null);
check("минуты словами", [minutesWords(12), minutesWords(185), minutesWords(3000), minutesWords(null)], ["12 мин", "3 ч", "2 дн.", "—"]);
check("переписка по номеру в другом написании", messagesForPhone([...talk, m("z", "2026-09-25T09:00:00Z", "in", "x", "77019990000")], "8 701 555 20 30").length, 6);
check("голосовое без расшифровки — подписью", messageText({ type: "voice", text: "" }), "[голосовое, не расшифровано]");
check("фото с подписью", messageText({ type: "image", text: "вот такие" }), "[фото] вот такие");

const many = Array.from({ length: 50 }, (_, i) => m(`L${i}`, `2026-09-25T${String(10 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00Z`, i % 2 ? "out" : "in", "слово ".repeat(20)));
const tr = transcriptForAi(many, 1500);
check("длинная переписка — остаются последние сообщения", tr.used[tr.used.length - 1].messageId, "L49");
check("длинная переписка — в пределе", tr.text.length <= 1500, true);
check("первое сообщение не попало", tr.used.some((x) => x.messageId === "L0"), false);

// --- Новые обращения -------------------------------------------------------------
const NOW = new Date("2026-09-25T15:00:00Z");
const inbox = buildInbox(
  [
    { ...m("i1", "2026-09-25T11:00:00Z", "in", "Здравствуйте, есть хризантема?", "77770001111"), senderName: "Салон Лилия" },
    m("i2", "2026-09-25T09:00:00Z", "in", "это клиент", "77015552030"),
    m("i3", "2026-09-25T08:00:00Z", "out", "рассылка", "77770002222"),
    m("i4", "2026-07-01T08:00:00Z", "in", "давно", "77770003333"),
  ],
  new Set(["7015552030"]),
  NOW
);
check("новые обращения: только незнакомые, писавшие сами, свежие", inbox.map((r) => [r.phone, r.name, r.waiting]), [["77770001111", "Салон Лилия", true]]);

// --- Ответ модели ----------------------------------------------------------------
const raw = {
  summary: "Салон спрашивал цену на розу 60, прайс отправили.",
  needs: "Роза 60 см, 500 шт. в неделю",
  agreed: "",
  next_step: "Позвонить завтра",
  next_touch_in_days: 1,
  suggested_stage: "offer",
  temperature: "warm",
  temperature_why: "просит прайс",
  objections: [{ kind: "price", quote: "дороговато" }, { kind: "выдумка", quote: "?" }],
  lost_reason: "Не нравится",
  checklist: [
    { key: "greeting", mark: "yes", comment: "" },
    { key: "needs", mark: "yes", comment: "" },
    { key: "offer", mark: "yes", comment: "" },
    { key: "objection", mark: "no", comment: "не ответил на «дорого»" },
    { key: "next_step", mark: "maybe", comment: "" },
    { key: "greeting", mark: "no", comment: "повтор" },
  ],
  advice: "Предложите пробную партию",
};
const p = parseAnalysis(raw);
check("чек-лист — все наши пункты по порядку", p.checklist.map((c) => c.key), CHECKLIST_KEYS);
check("повтор пункта не перебивает первый; непонятная отметка и пропуск — «не к месту»", p.checklist.map((c) => c.mark), ["yes", "yes", "yes", "no", "na", "na"]);
check("незнакомое возражение — «другое»", p.objections.map((o) => o.kind), ["price", "other"]);
check("незнакомая причина отказа — пусто", p.lostReason, "");
check("стадия и температура", [p.suggestedStage, p.temperature], ["offer", "warm"]);
check("незнакомая стадия — пусто", parseAnalysis({ ...raw, suggested_stage: "deal" }).suggestedStage, "");
check("дни ограничены 0–30", [parseAnalysis({ ...raw, next_touch_in_days: 99 }).nextTouchDays, parseAnalysis({ ...raw, next_touch_in_days: null }).nextTouchDays], [30, null]);
check("пустой ответ не роняет разбор", parseAnalysis(null).checklist.length, CHECKLIST_KEYS.length);
check("балл — доля «да» среди уместных", scoreOf(p.checklist), 75);
check("нечего оценивать — балла нет", scoreOf(CHECKLIST_KEYS.map((key) => ({ key, mark: "na" as const, comment: "" }))), null);

const schema = JSON.stringify(ANALYSIS_SCHEMA);
check("в схеме нет ключевых слов, которых не понимает строгий режим", /maxLength|minItems|maxItems|minLength/.test(schema), false);
const prompt = buildPrompt({ lead: { name: "Лилия", city: "Алматы", clientType: "", stage: "contact", contactPerson: "" }, transcript: "[25.09 10:00] Клиент: привет", today: "2026-09-25" });
check("в запросе есть лид и переписка", prompt.user.includes("Лилия") && prompt.user.includes("Клиент: привет"), true);

// --- Касание из разбора ------------------------------------------------------------
const A = (extra: Partial<LeadAnalysis> = {}): LeadAnalysis => ({
  analysisId: "T1", leadId: "L1", createdAt: "2026-09-25T12:00:00Z", createdByEmail: "m1@x", managerEmail: "m1@x",
  messagesFrom: "2026-09-25T09:00:00Z", messagesTo: "2026-09-25T12:00:00Z", messageCount: 6, model: "m",
  summary: "Кратко", needs: "", agreed: "500 шт. к пятнице", nextStep: "Выставить счёт", nextTouchDays: 3,
  suggestedStage: "offer", temperature: "hot", temperatureWhy: "", score: 80, checklist: [], objections: [],
  lostReason: "", advice: "", replyMinutes: 20, ...extra,
});
const pre = touchPrefill(A(), { stage: "contact", clientId: "" }, "2026-09-25");
check("касание: канал, стадия, дата", [pre.channel, pre.stage, pre.nextTouchAt], ["WhatsApp", "offer", "2026-09-28"]);
check("касание: комментарий из разбора", pre.comment, "Кратко\nДоговорились: 500 шт. к пятнице\nДальше: Выставить счёт");
check("«Пробный» без карточки клиента не ставим", touchPrefill(A({ suggestedStage: "trial" }), { stage: "offer", clientId: "" }, "2026-09-25").stage, "offer");
check("«Пробный» с карточкой — можно", touchPrefill(A({ suggestedStage: "trial" }), { stage: "offer", clientId: "C1" }, "2026-09-25").stage, "trial");
const lostPre = touchPrefill(A({ suggestedStage: "lost", lostReason: "" }), { stage: "offer", clientId: "" }, "2026-09-25");
check("отказ без причины — «Другое», без даты", [lostPre.lostReason, lostPre.nextTouchAt], ["Другое", ""]);

// --- Отчёт -------------------------------------------------------------------------
const lead = (id: string, phone: string, extra: Partial<Lead> = {}): Lead => ({
  leadId: id, createdAt: "2026-09-01T10:00:00", createdByEmail: "rop@x", name: `Лид ${id}`, city: "", contactPerson: "",
  phone, clientType: "", source: "", address: "", note: "", managerEmail: "m1@x", stage: "contact",
  stageChangedAt: "2026-09-01T10:00:00", nextTouchAt: "", lostReason: "", clientId: "", ...extra,
});
const leads = [lead("L1", "+7 701 555 20 30"), lead("L2", "87770001111", { managerEmail: "m2@x" }), lead("L3", "", { stage: "lost" })];
const msgs = [...talk, m("q1", "2026-09-25T10:00:00Z", "in", "?", "77770001111"), m("q2", "2026-09-25T10:30:00Z", "out", "!", "77770001111")];
const analyses = [
  A({ analysisId: "old", createdAt: "2026-09-25T11:00:00Z", score: 20 }),
  A({ analysisId: "new", createdAt: "2026-09-25T12:30:00Z", messagesTo: "2026-09-25T12:00:00Z", score: 80, checklist: [{ key: "offer", mark: "no", comment: "" }], objections: [{ kind: "price", quote: "" }, { kind: "price", quote: "" }] }),
  A({ analysisId: "x2", leadId: "L2", managerEmail: "m2@x", temperature: "cold", score: 50, objections: [{ kind: "supplier", quote: "" }] }),
];
const infos = talkInfoByLead(leads, msgs, analyses);
check("инфо только у лидов с перепиской или разбором", Array.from(infos.keys()), ["L1", "L2"]);
check("берётся последний разбор", infos.get("L1")?.analysis?.analysisId, "new");
check("новых после разбора", infos.get("L1")?.newMessages, 1);
check("новых без разбора — все", newSinceAnalysis(talk, undefined), 6);
const rep = buildTalkReport(Array.from(infos.values()), new Map([["m1@x", "Эмиль"]]), NOW);
check("менеджеры: имя, разборов, средняя оценка", rep.managers.map((x) => [x.name, x.analysed, x.avgScore]), [["Эмиль", 1, 80], ["m2@x", 1, 50]]);
check("пункт чек-листа по менеджеру — доля «да»", rep.managers[0].items.offer, 0);
check("возражение одного лида считается один раз", rep.objections.map((o) => [o.kind, o.count]), [["price", 1], ["supplier", 1]]);
check("ждут ответа больше часа — L1", rep.waiting.map((i) => i.leadId), ["L1"]);
check("горячие — по последнему разбору", rep.hot.map((i) => i.leadId), ["L1"]);
check("ждут разбора — только где после разбора есть новые сообщения", rep.stale.map((i) => i.leadId), ["L1"]);
check("разобрано за 30 дней", rep.analysedTotal, 2);

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
