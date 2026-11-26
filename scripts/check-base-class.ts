/**
 * Проверка «кто есть кто в базе» (26.11.2026): одна запись на человека, класс из фактов, хозяин и что с ним не так.
 *   npx tsx scripts/check-base-class.ts
 */
import { buyerClass, classifyBase, pickTaker, poolTalkers, prospectClass, workLists, type BaseCard, type BaseInput, type BaseLead } from "../src/lib/baseClass";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
const today = "2026-11-26";
check("покупавший: 30 дней — покупает, 31 — остывает", [buyerClass("2026-10-27", today), buyerClass("2026-10-26", today)], ["active", "cooling"]);
check("покупавший: 60 — остывает, 61 — спит, 180 — спит, 181 — потерян", [buyerClass("2026-09-27", today), buyerClass("2026-09-26", today), buyerClass("2026-05-30", today), buyerClass("2026-05-29", today)], ["cooling", "sleeping", "sleeping", "lost_client"]);

const none = { hasIn: false, hasOut: false, lastInAt: "", lastInText: "" };
const P = (x: Partial<Parameters<typeof prospectClass>[0]>) => prospectClass({ leads: [], outcomes: [], decision: "", optOut: false, facts: none, today, ...x });
check("ничего не было — не тронут", P({}), "untouched");
check("мы писали, ответа нет — молчит", P({ facts: { ...none, hasOut: true } }), "silent");
check("звонили, не дозвонились — молчит", P({ outcomes: ["no_answer"] }), "silent");
check("отвечал давно — тёплый", P({ facts: { hasIn: true, hasOut: true, lastInAt: "2026-10-01T05:00:00Z", lastInText: "пришлите прайс" } }), "warm");
check("писал на этой неделе — идёт разговор", P({ facts: { hasIn: true, hasOut: true, lastInAt: "2026-11-20T05:00:00Z", lastInText: "сколько стоит?" } }), "talking");
check("ответил «не интересует» — отказался", P({ facts: { hasIn: true, hasOut: true, lastInAt: "2026-11-20T05:00:00Z", lastInText: "Спасибо, не интересует" } }), "refused");
check("«СТОП» — отказался", P({ optOut: true, facts: { ...none, hasOut: true } }), "refused");
check("лид закрыт «Дорого» — отказался", P({ leads: [{ stage: "lost", lostReason: "Дорого" }] }), "refused");
check("лид закрыт «Не оптовик» — не наш", P({ leads: [{ stage: "lost", lostReason: "Не оптовик (розница)" }] }), "not_ours");
check("итог звонка «неверный номер» — не наш", P({ leads: [{ stage: "new", lostReason: "" }], outcomes: ["no_answer", "wrong_number"] }), "not_ours");
check("лид закрыт «Не выходит на связь» — молчит, а не отказался", P({ leads: [{ stage: "lost", lostReason: "Не выходит на связь" }] }), "silent");
check("отказ в лиде, но сам написал на днях — снова разговор", P({ leads: [{ stage: "lost", lostReason: "Дорого" }], facts: { hasIn: true, hasOut: true, lastInAt: "2026-11-24T05:00:00Z", lastInText: "А сейчас почём?" } }), "talking");
check("лид на стадии «Прайс / КП» без переписки — тёплый", P({ leads: [{ stage: "offer", lostReason: "" }] }), "warm");
check("интерес на звонке («отправил прайс») — тёплый", P({ leads: [{ stage: "new", lostReason: "" }], outcomes: ["price_sent"] }), "warm");
check("ИИ советует отказ, человек молчит — отказался", P({ leads: [{ stage: "contact", lostReason: "" }], decision: "lost", facts: { hasIn: true, hasOut: true, lastInAt: "2026-10-01T05:00:00Z", lastInText: "ок" } }), "refused");

const card = (x: Partial<BaseCard>): BaseCard => ({ clientId: "C1", name: "Цветы 24", city: "Алматы", phone: "+7 701 111 22 33", messenger: "", managerEmail: "ilyas@x.kz", retail: "", active: true, ...x });
const lead = (x: Partial<BaseLead>): BaseLead => ({ leadId: "L1", name: "Лид", city: "", phone: "+7 702 000 00 01", managerEmail: "", stage: "new", lostReason: "", clientId: "", origin: "", campaign: "", ...x });
const base = (x: Partial<BaseInput>): BaseInput => ({ cards: [], leads: [], orders: [], messages: [], touches: [], staff: new Set(), optedOut: new Set(), sellers: new Set(["ilyas@x.kz", "emil@x.kz"]), lineOwner: new Map([["m-emil", "emil@x.kz"]]), today, ...x });

const r1 = classifyBase(base({
  cards: [card({}), card({ clientId: "SHOP", phone: "+7 700 000 00 00", retail: "almaty" }), card({ clientId: "C2", name: "Без заказов", phone: "8 701 999 88 77", managerEmail: "old@x.kz" })],
  leads: [lead({ leadId: "L0", phone: "8 (701) 111-22-33", clientId: "C1", stage: "regular" }), lead({}), lead({ leadId: "L2", phone: "+7 705 555 00 00", managerEmail: "ilyas@x.kz" }), lead({ leadId: "L3", phone: "+7 777 000 00 09" })],
  orders: [
    { clientId: "C1", clientPhone: "", managerEmail: "emil@x.kz", day: "2026-11-01", amount: 50000 },
    { clientId: "C1", clientPhone: "", managerEmail: "emil@x.kz", day: "2026-11-20", amount: 70000 },
  ],
  messages: [
    { phone: "77011112233", at: "2026-11-21T05:00:00Z", direction: "in", line: "m-emil", text: "нужно 200" },
    { phone: "77020000001", at: "2026-11-10T05:00:00Z", direction: "out", line: "", text: "" },
    { phone: "77770000001", at: "2026-11-25T05:00:00Z", direction: "in", line: "m-emil", text: "Здравствуйте, почём роза?" },
    { phone: "77770000009", at: "2026-11-25T05:00:00Z", direction: "in", line: "", text: "принял" },
  ],
  staff: new Set(["7770000009"]),
}));
const by = (key: string) => r1.entries.find((e) => e.key === key)!;
check("одна запись на человека: карточка, её лид и переписка сведены", [r1.entries.length, by("7011112233").clientIds, by("7011112233").leadIds], [5, ["C1"], ["L0"]]);
check("покупавший: класс, заказы, деньги", [by("7011112233").kind, by("7011112233").cls, by("7011112233").orders, by("7011112233").revenue], ["client", "active", 2, 120000]);
check("карточка у Ильяса, продаёт и переписывается Эмиль — видно", [by("7011112233").owner, by("7011112233").soldBy, by("7011112233").chatWith], ["ilyas@x.kz", "emil@x.kz", "emil@x.kz"]);
check("написал последним — ждёт ответа", by("7011112233").waiting, true);
check("наш магазин и номер сотрудника в базу не идут", r1.outside, { shops: 1, staff: 1, noPhoneCards: 0, noPhoneLeads: 0 });
check("карточка без заказов у ушедшего менеджера", [by("7019998877").kind, by("7019998877").cls, by("7019998877").ownerState], ["card", "untouched", "gone"]);
check("лид без менеджера, которому писали с основного номера, — ничей и молчит", [by("7020000001").kind, by("7020000001").cls, by("7020000001").ownerState], ["lead", "silent", "none"]);
check("лид с менеджером, без касаний — не тронут, хозяин из лида", [by("7055550000").cls, by("7055550000").owner, by("7055550000").ownerFrom], ["untouched", "ilyas@x.kz", "lead"]);
check("написал на номер Эмиля, нет ни карточки, ни лида — «только переписка», хозяин по номеру", [by("7770000001").kind, by("7770000001").cls, by("7770000001").owner, by("7770000001").ownerFrom], ["contact", "talking", "emil@x.kz", "line"]);

const r2 = classifyBase(base({ cards: [card({}), card({ clientId: "C9", active: false })], leads: [lead({ leadId: "A", phone: "" }), lead({ leadId: "B", phone: "+7 701 111 22 33" })] }));
check("две карточки на один номер — одна запись с отметкой о дублях", [r2.entries.find((e) => e.key === "7011112233")?.clientIds.length, r2.entries.find((e) => e.key === "7011112233")?.duplicates], [2, 2]);
check("выключена — только если выключены все карточки", r2.entries.find((e) => e.key === "7011112233")?.off, false);
check("лид без телефона — отдельная запись и счётчик", [r2.entries.some((e) => e.key === "l:A"), r2.outside.noPhoneLeads], [true, 1]);
check("заявка по телефону без номера карточки находит человека", classifyBase(base({ cards: [card({})], orders: [{ clientId: "", clientPhone: "87011112233", managerEmail: "ilyas@x.kz", day: "2026-08-01", amount: 1 }] })).entries[0].cls, "sleeping");

// --- Переносы, пул, списки на день (решения владельца 26.11.2026) -------------------------------------------
check("перенос: покупателя — тому, кто оформляет его заявки", [by("7011112233").moveTo, by("7011112233").moveWhy], ["emil@x.kz", "последние заявки оформляет"]);
const mv = (x: Partial<BaseInput>) => classifyBase(base({ leads: [lead({ managerEmail: "ilyas@x.kz" })], messages: [{ phone: "77020000001", at: "2026-11-20T05:00:00Z", direction: "in", line: "m-emil", text: "почём роза?" }], ...x })).entries[0];
check("перенос: лид Ильяса пишет на номер Эмиля — предлагаем Эмилю", [mv({}).moveTo, mv({}).moveWhy], ["emil@x.kz", "пишет на номер (20.11)"]);
check("перенос: писал туда два месяца назад — не предлагаем", mv({ messages: [{ phone: "77020000001", at: "2026-09-20T05:00:00Z", direction: "in", line: "m-emil", text: "" }] }).moveTo, "");
check("перенос: номер Земфиры — не повод (она лидов передаёт сама)", mv({ lineOwner: new Map([["m-emil", "emil@x.kz"]]), takers: new Set(["ilyas@x.kz"]) }).moveTo, "");
check("перенос: отклонённый второй раз не предлагается", mv({ declined: new Set(["7020000001>emil@x.kz"]) }).moveTo, "");
check("перенос: тому, кто не работает с клиентами, не предлагаем", mv({ idle: new Set(["emil@x.kz"]) }).moveTo, "");
check("ничей лид пишет на номер Эмиля — предлагаем записать за ним", classifyBase(base({ leads: [lead({})], messages: [{ phone: "77020000001", at: "2026-11-20T05:00:00Z", direction: "in", line: "m-emil", text: "" }] })).entries[0].moveTo, "emil@x.kz");
check("человек без карточки и лида — записывать некуда, переноса нет", by("7770000001").moveTo, "");
check("хозяин не работает с клиентами — видно", classifyBase(base({ cards: [card({})], idle: new Set(["ilyas@x.kz"]) })).entries[0].ownerState, "gone");

const pl = classifyBase(base({ leads: [lead({ campaign: "Обзвон" }), lead({ leadId: "L5", phone: "+7 702 000 00 05", managerEmail: "ilyas@x.kz", campaign: "Обзвон" }), lead({ leadId: "L6", phone: "+7 702 000 00 06" })], messages: [{ phone: "77020000006", at: "2026-11-25T05:00:00Z", direction: "in", line: "", text: "Здравствуйте, пришлите прайс" }] }));
check("общий пул: нетронутый лид без менеджера; с менеджером — не пул; ответивший — не пул", pl.entries.map((e) => e.pool), [true, false, false]);
check("ответивший из пула — к раздаче менеджеру", poolTalkers(pl.entries).map((e) => e.leadIds[0]), ["L6"]);
const T = (email: string, city: string, hasLine: boolean, load: number) => ({ email, city, hasLine, load });
const takers = [T("ilyas@x.kz", "", true, 12), T("emil@x.kz", "", true, 7), T("saya@x.kz", "", false, 0), T("alex@x.kz", "Астана", true, 30)];
check("кому отдать: Астана — менеджеру Астаны, сколько бы у него ни было", pickTaker("г. Астана", takers), "alex@x.kz");
check("кому отдать: Алматы — у кого меньше разговоров среди тех, у кого подключён WhatsApp", pickTaker("Алматы", takers), "emil@x.kz");
check("кому отдать: город не указан — так же", pickTaker("", takers), "emil@x.kz");
check("кому отдать: ни у кого нет WhatsApp — просто у кого меньше", pickTaker("", [T("a@x.kz", "", false, 3), T("b@x.kz", "", false, 1)]), "b@x.kz");
check("кому отдать: некому — пусто", pickTaker("", []), "");

const E = (x: Partial<ReturnType<typeof classifyBase>["entries"][number]>) => ({ ...r1.entries[0], waiting: false, optOut: false, lastInAt: "", revenue: 0, ...x });
const wl = workLists(
  [
    E({ key: "a", cls: "active", waiting: true, lastInAt: "2026-11-25T05:00:00Z" }),
    E({ key: "b", cls: "talking", waiting: true, lastInAt: "2026-11-22T05:00:00Z" }),
    E({ key: "c", cls: "warm", waiting: true, lastInAt: "2026-09-01T05:00:00Z" }),
    E({ key: "d", cls: "cooling", revenue: 10 }),
    E({ key: "e", cls: "sleeping", revenue: 90 }),
    E({ key: "f", cls: "talking", lastInAt: "2026-11-20T05:00:00Z" }),
    E({ key: "g", cls: "warm", lastInAt: "2026-10-20T05:00:00Z" }),
    E({ key: "h", cls: "refused", waiting: true, lastInAt: "2026-11-25T05:00:00Z" }),
    E({ key: "i", cls: "cooling", optOut: true, revenue: 500 }),
  ],
  today
);
check("ответить: ждут не дольше двух недель, первым — кто ждёт дольше; отказавшихся нет", wl.reply.map((e) => e.key), ["b", "a"]);
check("ждут дольше двух недель — отдельным числом", wl.stale, 1);
check("вернуть: остывают и спят, первым — кто принёс больше; «СТОП» не трогаем", wl.back.map((e) => e.key), ["e", "d"]);
check("дожать: разговор и тёплые, где последнее слово за нами; свежие первыми", wl.push.map((e) => e.key), ["f", "g"]);

if (failed) {
  console.log(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
