/*
 * Проверка правил лидов (`src/lib/leads.ts`): кто что видит, касание, порядок
 * списка, сводка и разбор файла с базой.
 * Запуск: npx tsx scripts/check-leads.ts
 */
import {
  buildLeadRows,
  canSeeLead,
  canWorkLead,
  compareLeadRows,
  detectLeadColumns,
  leadChangesAfterTouch,
  parseLeadMatrix,
  phoneKey,
  summarizeLeads,
  touchRefusal,
  whatsappLink,
} from "../src/lib/leads";
import type { Lead, LeadTouch } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

const TODAY = "2026-09-25";
const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  leadId: id, createdAt: "2026-09-20T10:00:00", createdByEmail: "rop@x", name: `Лид ${id}`, city: "Алматы",
  contactPerson: "", phone: "", clientType: "", source: "", address: "", note: "", managerEmail: "m1@x",
  stage: "new", stageChangedAt: "2026-09-20T10:00:00", nextTouchAt: "", lostReason: "", clientId: "", ...extra,
});

// --- Телефон ------------------------------------------------------------------
check("+7 701 555 20 30 и 87015552030 — один номер", phoneKey("+7 701 555 20 30") === phoneKey("87015552030"), true);
check("короткий номер — не телефон", phoneKey("12-34"), "");
check("WhatsApp из 8-ки", whatsappLink("8 701 555 20 30"), "https://wa.me/77015552030");
check("WhatsApp из 10 цифр", whatsappLink("701 555 20 30"), "https://wa.me/77015552030");
check("WhatsApp без номера", whatsappLink(""), "");

// --- Кто видит ------------------------------------------------------------------
check("менеджер видит свой", canSeeLead("manager", "m1@x", { managerEmail: "m1@x" }), true);
check("менеджер видит ничей", canSeeLead("manager", "m1@x", { managerEmail: "" }), true);
check("менеджер НЕ видит чужой", canSeeLead("manager", "m1@x", { managerEmail: "m2@x" }), false);
check("РОП видит чужой", canSeeLead("sales_head", "r@x", { managerEmail: "m2@x" }), true);
check("бухгалтер не видит", canSeeLead("accountant", "b@x", { managerEmail: "" }), false);
check("ничей лид менеджер не ведёт, пока не взял", canWorkLead("manager", "m1@x", { managerEmail: "" }), false);
check("свой ведёт", canWorkLead("manager", "M1@x", { managerEmail: "m1@x" }), true);

// --- Касание --------------------------------------------------------------------
const base = { channel: "Звонок", comment: "Поговорили, ждут прайс", stage: "contact", nextTouchAt: "2026-09-27", lostReason: "" };
check("нормальное касание", touchRefusal(base, lead("A"), TODAY), "");
check("без комментария", touchRefusal({ ...base, comment: " ок" }, lead("A"), TODAY), "Напишите, о чём договорились");
check("выдуманный канал", touchRefusal({ ...base, channel: "Телеграм" }, lead("A"), TODAY), "Выберите, как связывались");
check("следующее в прошлом", touchRefusal({ ...base, nextTouchAt: "2026-09-24" }, lead("A"), TODAY), "Следующее касание не может быть в прошлом");
check("следующее не назначено", touchRefusal({ ...base, nextTouchAt: "" }, lead("A"), TODAY), "Когда следующее касание?");
check("опечатка в годе", touchRefusal({ ...base, nextTouchAt: "2062-09-27" }, lead("A"), TODAY), "Проверьте год следующего касания");
check("сегодня — можно", touchRefusal({ ...base, nextTouchAt: TODAY }, lead("A"), TODAY), "");
check("пробный заказ без клиента — нельзя", touchRefusal({ ...base, stage: "trial" }, lead("A"), TODAY).startsWith("Сначала заведите"), true);
check("пробный заказ с клиентом — можно", touchRefusal({ ...base, stage: "trial" }, lead("A", { clientId: "CLI-1" }), TODAY), "");
check("отказ без причины", touchRefusal({ ...base, stage: "lost", nextTouchAt: "" }, lead("A"), TODAY), "Укажите причину отказа");
check("отказ с причиной, без даты", touchRefusal({ ...base, stage: "lost", nextTouchAt: "", lostReason: "Дорого" }, lead("A"), TODAY), "");

const now = "2026-09-25T09:00:00.000Z";
check("стадия сдвинулась — пишем день", leadChangesAfterTouch(lead("A"), base, now), { Stage: "contact", StageChangedAt: now, NextTouchAt: "2026-09-27", LostReason: "" });
check(
  "стадия та же — день стадии не трогаем",
  leadChangesAfterTouch(lead("A", { stage: "contact" }), base, now),
  { NextTouchAt: "2026-09-27", LostReason: "" }
);
check(
  "отказ — касание снимается, причина пишется",
  leadChangesAfterTouch(lead("A", { stage: "offer" }), { ...base, stage: "lost", lostReason: "Дорого" }, now),
  { Stage: "lost", StageChangedAt: now, NextTouchAt: "", LostReason: "Дорого" }
);

// --- Список и порядок --------------------------------------------------------------
const leads = [
  lead("FUT", { stage: "contact", nextTouchAt: "2026-09-30" }),
  lead("TODAY", { stage: "need", nextTouchAt: TODAY }),
  lead("OLD", { stage: "contact", nextTouchAt: "2026-09-20" }),
  lead("OLDER", { stage: "offer", nextTouchAt: "2026-09-18" }),
  lead("NONE", { stage: "new" }),
  lead("LOST", { stage: "lost", lostReason: "Дорого", stageChangedAt: "2026-09-22T10:00:00", nextTouchAt: "2026-09-01" }),
  lead("WON", { stage: "trial", clientId: "CLI-1", stageChangedAt: "2026-09-24T10:00:00", managerEmail: "m2@x" }),
  lead("FREE", { managerEmail: "", nextTouchAt: TODAY }),
  lead("ODD", { stage: "что-то" }),
];
const touches: LeadTouch[] = [
  { touchId: "T1", leadId: "OLD", createdAt: "2026-09-19T10:00:00", managerEmail: "m1@x", channel: "Звонок", comment: "первый", stageFrom: "new", stageTo: "contact", nextTouchAt: "2026-09-20" },
  { touchId: "T2", leadId: "OLD", createdAt: "2026-09-22T10:00:00", managerEmail: "m1@x", channel: "WhatsApp", comment: "второй", stageFrom: "contact", stageTo: "contact", nextTouchAt: "2026-09-20" },
  { touchId: "T3", leadId: "WON", createdAt: "2026-09-10T10:00:00", managerEmail: "m2@x", channel: "Звонок", comment: "давно", stageFrom: "new", stageTo: "contact", nextTouchAt: "" },
];
const names = new Map([["m1@x", "Эмиль"], ["m2@x", "Ильяс"]]);
const rows = buildLeadRows(leads, touches, names, TODAY);
const byId = (id: string) => rows.find((r) => r.leadId === id)!;
check("касаний у OLD и последнее", [byId("OLD").touches, byId("OLD").lastComment], [2, "второй"]);
check("просрочено у OLD", byId("OLD").overdue, true);
check("у закрытого просрочки нет", byId("LOST").overdue, false);
check("незнакомая стадия читается как «Новый»", byId("ODD").stage, "new");
check("дней на стадии", byId("OLD").daysInStage, 5);
check(
  "порядок: просроченные, сегодня, по дате, без даты, закрытые",
  [...rows].sort(compareLeadRows).map((r) => r.leadId),
  ["OLDER", "OLD", "FREE", "TODAY", "FUT", "NONE", "ODD", "WON", "LOST"]
);

const summary = summarizeLeads(rows, touches, names, TODAY);
check("в работе (пробный заказ ещё открыт)", summary.open, 8);
check("просрочено", summary.overdue, 2);
check("на сегодня", summary.dueToday, 2);
check("ничьих", summary.unassigned, 1);
check("касаний за 7 дней (с 19-го включительно)", summary.touches7, 2);
const m2 = summary.byManager.find((m) => m.email === "m2@x")!;
check("Ильяс: дошёл до заказа за 30 дней", m2.won30, 1);
const m1 = summary.byManager.find((m) => m.email === "m1@x")!;
check("Эмиль: отказ и просрочки", [m1.lost30, m1.overdue], [1, 2]);
check("воронка сходится со списком", summary.byStage.reduce((s, x) => s + x.count, 0), rows.length);

// --- Файл с базой -------------------------------------------------------------------
check("заголовки со второй строки", detectLeadColumns([["Выгрузка на 25.09"], ["№", "Наименование", "Город", "Тел.", "Ответственный"]])?.headerRow, 1);
check("без колонки названия — нет", detectLeadColumns([["Город", "Телефон"]]), null);

const matrix = [
  ["Название", "Город", "Телефон", "Контактное лицо", "Тип точки", "Источник", "Комментарий", "Менеджер"],
  ["Салон Роза", "Алматы", "+7 701 111 22 33", "Айгуль", "флористический салон", "instagram", "берут розу", "Эмиль"],
  ["Цветы 24", "Астана", "87012223344", "", "", "", "", "m2@x"],
  ["Уже клиент", "Алматы", "8 (701) 999-88-77", "", "", "", "", ""],
  ["Уже лид", "Шымкент", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["Салон Роза 2", "Алматы", "7011112233", "", "", "", "", ""],
  ["", "Тараз", "87010000000", "", "", "", "", ""],
  ["Магнолия", "Алматы", "", "", "Непонятный тип", "", "", "Неизвестный"],
  ["Магнолия", "Алматы", "", "", "", "", "", ""],
];
const parsed = parseLeadMatrix(
  matrix,
  { leads: [lead("X", { name: "Уже лид", city: "Шымкент" })], clients: [{ name: "Другое имя", city: "Алматы", phone: "+77019998877" }] },
  [{ email: "m1@x", name: "Эмиль Нурланов" }, { email: "m2@x", name: "Ильяс" }]
);
const line = (n: number) => parsed.rows.find((r) => r.line === n)!;
check("пустая строка пропущена молча", parsed.rows.length, 8);
check("тип и источник из списка без регистра", [line(2).clientType, line(2).source], ["Флористический салон", "Instagram"]);
check("менеджер по имени", line(2).managerEmail, "m1@x");
check("менеджер по почте", line(3).managerEmail, "m2@x");
check("уже клиент по телефону", line(4).skip, "уже клиент (тот же телефон)");
check("уже лид по названию и городу", line(5).skip, "уже в лидах (то же название и город)");
check("повтор телефона в файле", line(7).skip, "повтор в файле, строка 2 (тот же телефон)");
check("без названия", line(8).skip, "нет названия");
check("незнакомый тип — пусто", line(9).clientType, "");
check("незнакомый менеджер — ничей", line(9).managerEmail, "");
check("второй «Магнолия» в том же городе — повтор", line(10).skip.startsWith("повтор в файле"), true);
check("новых и пропущенных", [parsed.fresh, parsed.skipped], [3, 5]);
check("нет заголовков — понятная ошибка", !!parseLeadMatrix([["a", "b"]], { leads: [], clients: [] }, []).fatalError, true);

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
