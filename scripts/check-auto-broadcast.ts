/**
 * Проверка автопилота рассылок (17.10.2026): настройки, когда собирать и запускать план, «отмена»,
 * кому лидам напоминать, кто «давно не заказывал», тексты, письмо с планом, замок цепочки.
 *   npx tsx scripts/check-auto-broadcast.ts
 */
import {
  AUTO_CAPS,
  CHAIN_LOCK_SECONDS,
  EMPTY_PLAN,
  activateAtFor,
  activationDue,
  almatyParts,
  chainBusy,
  chainWait,
  chatFacts,
  commonExclusion,
  freshText,
  isCancelText,
  isSleeping,
  leadReminderText,
  orderedRecently,
  parseAutoConfig,
  parseChainLock,
  parsePlanRecord,
  pickLeadReminders,
  planDue,
  planMessageText,
  planRecordValue,
  pushText,
  sentFacts,
  sleepingText,
  usualGapDays,
  type ExclusionContext,
} from "../src/lib/autoBroadcast";
import { OPT_OUT_LINE } from "../src/lib/broadcast";
import { lastBroadcastForBot } from "../src/lib/botKnowledge";
import { chainDrives } from "../src/lib/autoBroadcastRunner";
import type { Lead, WaMessage } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const at = (s: string) => new Date(`${s}+05:00`);

// --- Настройки ---------------------------------------------------------------------------------
check("нет настройки — всё включено", parseAutoConfig(undefined).rules, { leads: true, sleeping: true, push: true, fresh: true });
check("выключено одно", parseAutoConfig('{"rules":{"fresh":false}}').rules.fresh, false);
check("испорченная — как по умолчанию", parseAutoConfig("{oops").rules.leads, true);
check("план: туда-обратно", parsePlanRecord(planRecordValue({ ...EMPTY_PLAN, day: "2026-10-17", ids: ["BC-1"], counts: { leads: 3 } })).counts, { leads: 3 });

// --- Время ---------------------------------------------------------------------------------------
check("Алматы: день и час", almatyParts(new Date("2026-10-17T04:30:00Z")), { day: "2026-10-17", hour: 9, minutes: 570, weekday: 6 });
const cfg = parseAutoConfig("");
check("план: суббота 9:05 — пора", planDue(at("2026-10-17T09:05:00"), EMPTY_PLAN, cfg), true);
check("план: 8:55 — рано", planDue(at("2026-10-17T08:55:00"), EMPTY_PLAN, cfg), false);
check("план: 16:10 — поздно", planDue(at("2026-10-17T16:10:00"), EMPTY_PLAN, cfg), false);
check("план: воскресенье — нет", planDue(at("2026-10-18T09:30:00"), EMPTY_PLAN, cfg), false);
check("план: уже собран сегодня — нет", planDue(at("2026-10-17T11:00:00"), { ...EMPTY_PLAN, day: "2026-10-17" }, cfg), false);
check("план: вчерашний — пора", planDue(at("2026-10-17T11:00:00"), { ...EMPTY_PLAN, day: "2026-10-16" }, cfg), true);
check(
  "план: все правила выключены — нет",
  planDue(at("2026-10-17T09:30:00"), EMPTY_PLAN, parseAutoConfig('{"rules":{"leads":false,"sleeping":false,"push":false,"fresh":false}}')),
  false
);
check("запуск: собран в 9:05 — в 10:00", activateAtFor(at("2026-10-17T09:05:00")), "2026-10-17T05:00:00.000Z");
check("запуск: собран в 9:30 — в 10:15", activateAtFor(at("2026-10-17T09:30:00")), "2026-10-17T05:15:00.000Z");
check("запуск: собран в 13:00 — в 13:45", activateAtFor(at("2026-10-17T13:00:00")), "2026-10-17T08:45:00.000Z");
const planned = { ...EMPTY_PLAN, day: "2026-10-17", ids: ["BC-1"], activateAt: "2026-10-17T05:00:00.000Z" };
check("запуск: 9:59 — ещё нет", activationDue(at("2026-10-17T09:59:00"), planned), false);
check("запуск: 10:00 — да", activationDue(at("2026-10-17T10:00:00"), planned), true);
check("запуск: отменён — нет", activationDue(at("2026-10-17T10:30:00"), { ...planned, cancelled: true }), false);
check("запуск: уже запущен — нет", activationDue(at("2026-10-17T10:30:00"), { ...planned, activated: true }), false);
check("запуск: план вчерашний — нет", activationDue(at("2026-10-18T10:30:00"), planned), false);
check("запуск: пустой план — нет", activationDue(at("2026-10-17T10:30:00"), { ...planned, ids: [] }), false);

// --- «Отмена» --------------------------------------------------------------------------------------
check(
  "отмена: да",
  ["отмена", "Отмена!", "ОТМЕНА", " отменить ", "не отправляй", "Отмена рассылки"].map(isCancelText),
  [true, true, true, true, true, true]
);
check("отмена: нет", ["стоп", "СТОП", "отмена заказа 123", "", "ок", "давай отменим завтрашний заказ пожалуйста"].map(isCancelText), [false, false, false, false, false, false]);

// --- Кто разговаривает и кому что уходило --------------------------------------------------------------
const now = at("2026-10-17T09:10:00");
const msg = (phone: string, iso: string, direction: "in" | "out", line = ""): WaMessage =>
  ({ messageId: `${phone}${iso}${direction}`, at: new Date(`${iso}+05:00`).toISOString(), chatId: "", phone, direction, type: "text", text: "", mediaUrl: "", senderName: "", source: "", line }) as WaMessage;
const messages = [
  msg("77010000001", "2026-10-10T12:00:00", "in", "leads"),
  msg("77010000001", "2026-10-11T12:00:00", "out", "leads"),
  msg("77010000002", "2026-10-12T12:00:00", "in", "leads"), // ждёт ответа
  msg("77010000003", "2026-10-16T20:00:00", "out", "leads"), // меньше суток
  msg("77010000004", "2026-10-01T12:00:00", "in", "m-ilyas"),
  msg("77010000004", "2026-10-02T12:00:00", "out", "m-ilyas"),
  msg("77010000005", "2026-10-05T12:00:00", "out", "leads"),
  msg("77010000006", "2026-10-05T12:00:00", "out", "leads"),
  msg("77010000007", "2026-10-05T12:00:00", "out", "m-off"),
  msg("77010000008", "2026-10-05T12:00:00", "out", "leads"),
  msg("77010000009", "2026-10-05T12:00:00", "out", "leads"),
];
const facts = chatFacts(messages);
check("переписка: последнее и номер", facts.get("7010000004"), { lastAt: new Date("2026-10-02T12:00:00+05:00").toISOString(), lastDirection: "out", line: "m-ilyas", lastInAt: new Date("2026-10-01T12:00:00+05:00").toISOString(), lastInText: "" });
const iso = (s: string) => new Date(`${s}+05:00`).toISOString();
const sent = sentFacts(
  [
    { broadcastId: "A1", phone: "77010000005", status: "sent", sentAt: iso("2026-10-07T11:00:00") },
    { broadcastId: "A2", phone: "77010000005", status: "sent", sentAt: iso("2026-10-11T11:00:00") }, // два без ответа
    { broadcastId: "A1", phone: "77010000006", status: "sent", sentAt: iso("2026-10-15T11:00:00") }, // меньше 4 дней
    { broadcastId: "M1", phone: "77010000009", status: "sent", sentAt: iso("2026-10-12T11:00:00") }, // ручная рассылка 5 дней назад
    { broadcastId: "A1", phone: "77010000001", status: "queued", sentAt: "" },
  ],
  new Map([
    ["A1", "leads"],
    ["A2", "leads"],
    ["M1", ""],
  ])
);
check("рассылки: напоминания лиду", sent.get("7010000005")?.leadReminders.length, 2);
check("рассылки: ждущий не в счёт", sent.has("7010000001"), false);
const ctx: ExclusionContext = { now, staff: new Set(["7010000099"]), optedOut: new Set(["7010000098"]), facts, sent };
check("запрет: сотрудник", commonExclusion("7010000099", ctx), "сотрудник");
check("запрет: отписался", commonExclusion("7010000098", ctx), "отписался");
check("запрет: переписка вчера вечером", commonExclusion("7010000003", ctx), "переписка меньше суток назад");
check("запрет: рассылка 2 дня назад", commonExclusion("7010000006", ctx), "рассылка была за 7 дн.");
check("запрет: можно", commonExclusion("7010000004", ctx), "");

// --- Лиды ----------------------------------------------------------------------------------------------
const lead = (id: string, phone: string, extra: Partial<Lead> = {}): Lead =>
  ({ leadId: id, name: `Лид ${id}`, contactPerson: "", phone, managerEmail: "z@x", stage: "contact", nextTouchAt: "2026-10-15", clientId: "", ...extra }) as Lead;
const leads = [
  lead("L1", "+77010000001"),
  lead("L2", "+77010000002"),
  lead("L3", "+77010000003"),
  lead("L4", "+77010000004", { nextTouchAt: "2026-10-17" }),
  lead("L5", "+77010000005"),
  lead("L6", "+77010000006"),
  lead("L7", "+77010000007"),
  lead("L8", "+77010000008"),
  lead("L9", "+77010000009"),
  lead("L10", "+77010000001"), // тот же номер
  lead("L11", "+77010000010"), // нет переписки
  lead("L12", "+77010000001", { nextTouchAt: "2026-10-20" }), // касание не сегодня
  lead("L13", "+77010000004", { stage: "lost" }),
];
const analyses = new Map([
  ["L1", { createdAt: iso("2026-10-12T10:00:00"), decision: "follow_up" as const, draft: "Добрый день! Как вам наша хризантема?", nextTouchDays: 3, lostReason: "", suggestedStage: "", temperature: "" as const }],
  ["L8", { createdAt: iso("2026-10-06T10:00:00"), decision: "lost" as const, draft: "", nextTouchDays: null, lostReason: "Дорого", suggestedStage: "lost", temperature: "" as const }],
  ["L4", { createdAt: iso("2026-10-16T10:00:00"), decision: "follow_up" as const, draft: "Позже", nextTouchDays: 5, lostReason: "", suggestedStage: "", temperature: "" as const }],
]);
const picked = pickLeadReminders({
  leads,
  analyses,
  ctx,
  today: "2026-10-17",
  lineOk: (l) => l !== "m-off",
  toDay: (x) => x.slice(0, 10),
});
check("лиды: кому", picked.take.map((p) => p.lead.leadId), ["L1", "L9"]);
check("лиды: с какого номера", picked.take.map((p) => p.line), ["leads", "leads"]);
check("лиды: черновик разбора автопилот не шлёт (21.10.2026 — обещал «оформим сейчас»)", picked.take[0].draft, "");
check("лиды: ждут живого ответа", picked.waiting.map((l) => l.leadId), ["L2"]);
check("лиды: пропуски", Object.fromEntries(Object.entries(picked.skipped).sort()), Object.fromEntries(Object.entries({
  "клиент ждёт ответа": 1,
  "переписка меньше суток назад": 1,
  "ИИ советует написать позже": 1,
  "два напоминания без ответа": 1,
  "рассылка была за 4 дн.": 1,
  "номер, где шла переписка, не подключён": 1,
  "ИИ советует отказ": 1,
  "номер повторяется": 1,
  "нет переписки в WhatsApp": 1,
}).sort()));
// Разбор старше последнего сообщения — черновик не годится; клиент ответил после напоминаний — счёт заново.
const facts2 = chatFacts([...messages, msg("77010000005", "2026-10-12T09:00:00", "in", "leads"), msg("77010000005", "2026-10-12T10:00:00", "out", "leads")]);
const picked2 = pickLeadReminders({
  leads: [lead("L5", "+77010000005")],
  analyses: new Map([["L5", { createdAt: iso("2026-10-11T10:00:00"), decision: "sell" as const, draft: "Старый черновик", nextTouchDays: null, lostReason: "", suggestedStage: "", temperature: "" as const }]]),
  ctx: { ...ctx, facts: facts2 },
  today: "2026-10-17",
  lineOk: () => true,
  toDay: (x) => x.slice(0, 10),
});
check("лиды: ответил после напоминаний — снова можно", picked2.take.map((p) => p.lead.leadId), ["L5"]);
check("лиды: разбор старше переписки — без черновика", picked2.take[0]?.draft, "");
// Замечания Земфиры (21.10.2026): переданным менеджеру, с карточкой клиента и отказавшимся — не пишем.
const refused = { ...msg("77010000021", "2026-10-10T12:00:00", "in", "leads"), text: "Спасибо, неактуально, это для себя" };
const picked3 = pickLeadReminders({
  leads: [
    lead("H1", "+77010000020", { handedOverAt: "2026-10-15T10:00:00Z", managerEmail: "ilgar@x" }),
    lead("H2", "+77010000021"),
    lead("H3", "+77010000022"),
    lead("H4", "+77010000023"),
  ],
  analyses: new Map(),
  ctx: {
    ...ctx,
    facts: chatFacts([
      msg("77010000020", "2026-10-05T12:00:00", "out", "leads"),
      refused,
      msg("77010000021", "2026-10-11T12:00:00", "out", "leads"),
      msg("77010000022", "2026-10-05T12:00:00", "out", "leads"),
      msg("77010000023", "2026-10-05T12:00:00", "out", "leads"),
    ]),
  },
  today: "2026-10-17",
  lineOk: () => true,
  toDay: (x) => x.slice(0, 10),
  clientKeys: new Set(["7010000022"]),
});
check("лиды: переданный, с карточкой и отказавшийся — нет, остальной — да", picked3.take.map((p) => p.lead.leadId), ["H4"]);
check("лиды: почему", picked3.skipped, { "передан менеджеру": 1, "клиент отказался": 1, "есть карточка клиента": 1 });
check("переписка: текст последнего входящего", chatFacts([refused]).get("7010000021")?.lastInText, "Спасибо, неактуально, это для себя");

const many = Array.from({ length: AUTO_CAPS.leads + 5 }, (_, i) => {
  const ph = `7702${String(i).padStart(7, "0")}`;
  return { lead: lead(`M${i}`, `+${ph}`), msg: msg(ph, "2026-10-05T12:00:00", "out", "leads") };
});
const capped = pickLeadReminders({
  leads: many.map((m) => m.lead),
  analyses: new Map(),
  ctx: { ...ctx, facts: chatFacts(many.map((m) => m.msg)) },
  today: "2026-10-17",
  lineOk: () => true,
  toDay: (x) => x.slice(0, 10),
});
check("лиды: предел на номер", capped.take.length, AUTO_CAPS.leads);

// --- Давно не заказывали --------------------------------------------------------------------------------
check("обычный перерыв", usualGapDays(["2026-09-01", "2026-09-05", "2026-09-09"]), 4);
check("перерыв: один заказ — неизвестен", usualGapDays(["2026-09-01"]), null);
check("молчит: 10 дней при перерыве 4 — да", isSleeping(["2026-09-27", "2026-10-01", "2026-10-07"], "2026-10-17"), true);
check("молчит: 8 дней при перерыве 6 — нет (меньше 1,5×)", isSleeping(["2026-09-21", "2026-09-27", "2026-10-03", "2026-10-09"], "2026-10-17"), false);
check("молчит: 5 дней — рано", isSleeping(["2026-10-12"], "2026-10-17"), false);
check("молчит: 70 дней — уже не вернуть рассылкой", isSleeping(["2026-08-08"], "2026-10-17"), false);
check("молчит: один заказ 20 дней назад — да", isSleeping(["2026-09-27"], "2026-10-17"), true);
check("заказывал за 3 дня", [orderedRecently(["2026-10-15"], "2026-10-17"), orderedRecently(["2026-10-13"], "2026-10-17")], [true, false]);

// --- Тексты ---------------------------------------------------------------------------------------------
const lab = (o: { variety: string; grade: string }) => `Хризантема ${o.variety}, ${o.grade}`;
const offer = { flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", price: 250, qty: 900 };
const sleepT = sleepingText({ last: [{ label: "Хризантема Altaj, Первая", quantity: 300 }], offers: [offer], label: lab });
check("давно не заказывали: что брали", sleepT.includes("• Хризантема Altaj, Первая — 300 шт."), true);
check("давно не заказывали: цена жирным", sleepT.includes("*250 ₸*"), true);
check("давно не заказывали: «СТОП» в конце", sleepT.endsWith(OPT_OUT_LINE), true);
check("давно не заказывали: обращение по имени", sleepT.startsWith("Здравствуйте, {имя}!"), true);
check("лиду: черновик как есть, без «СТОП»", leadReminderText({ draft: "Привет", manager: "Земфира", offers: [offer], label: lab }), "Привет");
const leadT = leadReminderText({ draft: "", manager: "Земфира", offers: [offer], label: lab });
check("лиду: представляется", leadT.startsWith("Здравствуйте, {имя}! Это Земфира, Ecoculture."), true);
check("лиду: без «СТОП»", leadT.includes("СТОП"), false);
const pushT = pushText({ label: "Хризантема, четвёртая категория", varieties: [{ variety: "Altaj", qty: 5000, price: 180 }, { variety: "Chik", qty: 20, price: 170 }], bulkFrom: 1000, bulkPrice: 160 });
check("распродажа: сорт с ценой, мелкий остаток не предлагаем", [pushT.includes("• Altaj — *180 ₸*"), pushT.includes("Chik")], [true, false]);
check("распродажа: цена от объёма", pushT.includes("От 1 000 шт. — *160 ₸* за стебель."), true);
check("срез: «СТОП»", freshText([offer], lab).endsWith(OPT_OUT_LINE), true);

// --- Письмо с планом -----------------------------------------------------------------------------------
const planT = planMessageText({
  parts: [
    { rule: "leads", lineLabel: "номер Земфиры", count: 12, sample: "" },
    { rule: "sleeping", lineLabel: "", count: 9, sample: sleepT },
  ],
  activateAt: "2026-10-17T05:00:00.000Z",
  link: "https://www.crm-ecoculture.kz/clients/broadcasts/auto",
  waiting: 3,
});
check("план: итог и время", planT.includes("С 10:00 уйдёт 21 сообщ."), true);
check("план: по правилам", planT.includes("• Дожим просроченных лидов (номер Земфиры): 12"), true);
check("план: пример с именем, без «СТОП»", [planT.includes("Здравствуйте, Айгерим!"), planT.includes(OPT_OUT_LINE)], [true, false]);
check("план: как остановить", planT.includes("ответьте *ОТМЕНА*"), true);
check("план: ждущие лиды", planT.includes("Ещё 3 лид(ов) ждут живого ответа"), true);

// --- Бот знает личный текст ----------------------------------------------------------------------
const botKnows = lastBroadcastForBot(
  [{ broadcastId: "A1", title: "Авто · Давно не заказывали · 17.10", text: "Образец", startedAt: "2026-10-17T05:00:00Z", createdAt: "2026-10-17T04:00:00Z" }],
  [{ broadcastId: "A1", phone: "77010000005", status: "sent", sentAt: "2026-10-17T05:10:00Z", text: "Здравствуйте, {имя}! В прошлый раз брали Altaj" }],
  "87010000005"
);
check("бот: личный текст получателя", botKnows.includes("В прошлый раз брали Altaj") && !botKnows.includes("Образец"), true);

// --- Что сайт ведёт сам ---------------------------------------------------------------------------
const nowD = new Date("2026-10-18T08:00:00Z");
const bc = (x: Partial<{ status: string; auto: string; plannedFor: string; startedAt: string; createdAt: string }>) =>
  ({ status: "sending", auto: "", plannedFor: "", startedAt: "", createdAt: "", ...x });
check("ведёт: сегодняшний автопилот", chainDrives(bc({ auto: "sleeping", plannedFor: "2026-10-18" }), "2026-10-18", nowD), true);
check("ведёт: вчерашний автопилот — нет", chainDrives(bc({ auto: "sleeping", plannedFor: "2026-10-17" }), "2026-10-18", nowD), false);
check("ведёт: рассылка человека, запущена сегодня", chainDrives(bc({ startedAt: "2026-10-18T05:00:00Z" }), "2026-10-18", nowD), true);
check("ведёт: брошенная рассылка от 02.10 — нет", chainDrives(bc({ startedAt: "2026-10-02T06:55:06Z" }), "2026-10-18", nowD), false);
check("ведёт: на паузе — нет", chainDrives(bc({ status: "paused", startedAt: "2026-10-18T05:00:00Z" }), "2026-10-18", nowD), false);

// --- Цепочка -----------------------------------------------------------------------------------------
check("ожидание: минимальное", chainWait([90, 20, 1800]), 20);
check("ожидание: не меньше секунды", chainWait([0, 5]), 1);
check("ожидание: нечего", chainWait([]), 0);
const lockNow = new Date("2026-10-17T06:00:00Z");
const lock = parseChainLock(JSON.stringify({ token: "A", at: new Date(lockNow.getTime() - 30000).toISOString(), note: "x" }));
check("замок: чужой и свежий — занят", chainBusy(lock, "B", lockNow), true);
check("замок: свой — свободен", chainBusy(lock, "A", lockNow), false);
check("замок: протух — свободен", chainBusy({ ...lock, at: new Date(lockNow.getTime() - (CHAIN_LOCK_SECONDS + 5) * 1000).toISOString() }, "B", lockNow), false);
check("замок: отпущен — свободен", chainBusy(parseChainLock('{"token":"","at":""}'), "B", lockNow), false);
check("замок: испорчен — свободен", chainBusy(parseChainLock("oops"), "B", lockNow), false);

if (failed) {
  console.log(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
