/*
 * Проверка обзвона: чтение выгрузки из прошлой CRM, группы и «что известно»,
 * раздача поровну, итог звонка → касание, очередь менеджера и отчёт РОПа.
 *
 * Запуск: npx tsx scripts/check-calls.ts
 */
import ExcelJS from "exceljs";
import { readXlsxSheets, parseCsv } from "../src/lib/xlsxLite";
import { collectRequests, dealEvenly, parseLeadMatrix, pickLeadSheet, rowsToMatrix, touchRefusal, normalizePhone, guessCity } from "../src/lib/leads";
import { buildCallQueue, buildCallReport, planCall, MAX_NO_ANSWER, CALL_OUTCOMES } from "../src/lib/calls";
import { toIsoDate } from "../src/lib/sheetDate";
import type { Lead, LeadTouch } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

const TODAY = "2026-10-05";

async function main() {
  // --- Чтение файла в браузере (xlsxLite) -------------------------------------
  const wb = new ExcelJS.Workbook();
  const dash = wb.addWorksheet("Дашборд");
  dash.addRow(["Оптовые продажи — сводка"]);
  dash.addRow(["Сделок всего", 10]);
  const deals = wb.addWorksheet("Сделки");
  deals.addRow(["ID_сделки", "Дата_создания", "Клиент", "Телефон", "ID_контакта", "Комментарий", "Комментарий_контакта"]);
  deals.addRow([1, new Date(Date.UTC(2026, 0, 5, 10)), "Анна", "+77010000001", "C1", "Нет", ""]);
  deals.addRow([2, new Date(Date.UTC(2026, 1, 7, 10)), "Анна", "+77010000001", "C1", "270 хризантем", "<div>к&nbsp;8 марта</div>"]);
  deals.addRow([3, new Date(Date.UTC(2026, 1, 8, 10)), "Анна", "+77010000001", "C1", "270 хризантем", ""]);
  const cl = wb.addWorksheet("Клиенты");
  cl.addRow(["Ключ", "Менеджер", "N", "Клиент", "Телефон", "Статус", "Заказов", "Выручка", "Основной_сорт", "Вид_клиента", "Филиал", "Адрес", "ID_контакта", "Первое_обращение", "Последний_заказ", "Заявок_без_заказа", "Источник"]);
  cl.addRow(["k1", "Ильяс Мешелов", 1, "Шахмурад", "+77771484146", "Спящий", 6, 53857800, "Altaj", "Мелкий опт", "Алматы", "Алматы", "C9", new Date(Date.UTC(2026, 1, 12)), new Date(Date.UTC(2026, 7, 14)), 0, ""]);
  cl.addRow(["k2", "Юлия", 2, "Анна", "8 701 000 00 01", "Только заявка", 0, 0, "", "", "", "", "C1", new Date(Date.UTC(2026, 0, 5)), null, 2, "WhatsApp Таргет ОПТ Астаны"]);
  cl.addRow(["k3", "Юлия", 3, "Анна (дубль)", "+77010000001", "Потерян", 2, 100000, "Red Naomi", "", "", "", "C1", new Date(Date.UTC(2025, 11, 1)), new Date(Date.UTC(2026, 2, 1)), 0, ""]);
  cl.addRow(["k4", "Юлия", 4, "Без имени", "", "Только заявка", 0, 0, "", "", "", "", "C4", null, null, 1, ""]);
  cl.addRow(["k5", "Юлия", 5, "Хайдар", "+77074942936", "Активный", 38, 11702100, "Altaj", "Средний опт", "Алматы", "", "C5", new Date(Date.UTC(2026, 0, 28)), null, 0, ""]);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const sheets = await readXlsxSheets(new Uint8Array(buf));
  check("листы по порядку", sheets.map((s) => s.name), ["Дашборд", "Сделки", "Клиенты"]);
  check("строка из общего словаря и число", sheets[0].matrix[1], ["Сделок всего", "10"]);
  check("дата — серийник Excel, понимается toIsoDate", toIsoDate(sheets[2].matrix[1][13]), "2026-02-12");
  check("CSV с «;» и кавычками", parseCsv('Название;Телефон\n"Салон ""Роза""";+7701'), [["Название", "Телефон"], ['Салон "Роза"', "+7701"]]);

  const picked = pickLeadSheet(sheets)!;
  check("база — лист, где узнаётся больше колонок, а не первый", picked.name, "Клиенты");
  const req = collectRequests(sheets, picked.name);
  check("что спрашивал: без «Нет», без повторов, свежие сверху, без разметки", req.get("C1"), ["07.02 — 270 хризантем", "07.02 — к 8 марта"]);

  const parsed = parseLeadMatrix(picked.matrix, { leads: [], clients: [] }, [], req);
  const byLine = (n: number) => parsed.rows.find((r) => r.line === n)!;
  const shah = byLine(2);
  check("группа из «Статуса»", shah.segment, "Спящий");
  check("покупки и первое обращение", [shah.pastOrders, shah.firstSeenAt], [6, "2026-02-12"]);
  check(
    "«что известно» одной строкой",
    shah.history,
    "Спящий · 6 заказов на 53 857 800 ₸ · последний 14.08.2026 · брал Altaj · впервые написал 12.02.2026 · Мелкий опт · вёл(а): Ильяс Мешелов"
  );
  check("вид клиента «Мелкий опт» → «Оптовик»", shah.clientType, "Оптовик");
  check("город из филиала, адрес-город не дублируется", [shah.city, shah.address], ["Алматы", ""]);
  check("один телефон дважды — остаётся строка, где покупали", [byLine(3).skip.startsWith("повтор в файле"), byLine(4).skip], [true, ""]);
  check("у оставленной строки — что спрашивал", byLine(4).history.includes("спрашивал: 07.02 — 270 хризантем"), true);
  check("город из источника «…ОПТ Астаны»", guessCity("", "", "WhatsApp Таргет ОПТ Астаны"), "Астана");
  check("без телефона — не заводим", byLine(5).skip, "нет телефона");
  check("телефон к одному виду", [normalizePhone("8 701 000 00 01"), normalizePhone("7771484146"), normalizePhone("636")], ["+77010000001", "+77771484146", "636"]);
  check("группы с числом новых", parsed.segments, [
    { name: "Спящий", count: 1, bought: true },
    { name: "Потерян", count: 1, bought: true },
    { name: "Активный", count: 1, bought: true },
  ]);

  // Сервер разбирает присланные строки тем же разбором — ничего не теряется.
  const fresh = parsed.rows.filter((r) => !r.skip);
  const again = parseLeadMatrix(rowsToMatrix(fresh), { leads: [], clients: [] }, []);
  check(
    "строки → таблица → строки: то же самое",
    again.rows.map((r) => [r.name, r.phone, r.city, r.segment, r.pastOrders, r.firstSeenAt, r.history, r.skip]),
    fresh.map((r) => [r.name, r.phone, r.city, r.segment, r.pastOrders, r.firstSeenAt, r.history, ""])
  );
  const vsClients = parseLeadMatrix(rowsToMatrix(fresh), { leads: [], clients: [{ name: "Х", city: "", phone: "87771484146" }] }, []);
  check("на сервере: кто уже клиент — пропускается", vsClients.rows[0].skip, "уже клиент (тот же телефон)");

  // --- Раздача поровну -----------------------------------------------------------
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const items = Array.from({ length: 101 }, (_, i) => ({ id: i, bought: i < 23 }));
  const dealt = dealEvenly(items, ["a", "b", "c"], (x) => x.bought, rnd);
  const count = (pred: (x: { id: number; bought: boolean }) => boolean) =>
    ["a", "b", "c"].map((e) => items.filter((x) => pred(x) && dealt.get(x) === e).length);
  const all = count(() => true);
  const boughtSplit = count((x) => x.bought);
  check("раздано всем", dealt.size, 101);
  check("поровну ±1", Math.max(...all) - Math.min(...all) <= 1, true);
  check("бывшие покупатели тоже поровну ±1", Math.max(...boughtSplit) - Math.min(...boughtSplit) <= 1, true);
  check("некому раздавать — никому", dealEvenly(items, [], (x) => x.bought).size, 0);

  // --- Итог звонка → касание -------------------------------------------------------
  const fresh0 = { stage: "new", clientId: "" };
  const plan = (outcome: string, extra: Partial<{ comment: string; date: string; reason: string }> = {}, lead = fresh0, attempts = 0) =>
    planCall({ outcome, comment: "", date: "", reason: "", ...extra }, lead, attempts, TODAY);
  const ok = (p: ReturnType<typeof plan>) => (typeof p === "string" ? null : p);

  const na1 = ok(plan("no_answer"))!;
  check("не дозвонился: стадия та же, перезвон завтра", [na1.touch.stage, na1.touch.nextTouchAt, na1.closed], ["new", "2026-10-06", false]);
  check("в комментарии — номер попытки", na1.touch.comment, `Не дозвонился (попытка 1 из ${MAX_NO_ANSWER})`);
  const na3 = ok(plan("no_answer", {}, fresh0, MAX_NO_ANSWER - 1))!;
  check("третий раз — закрываем «не выходит на связь»", [na3.touch.stage, na3.touch.lostReason, na3.touch.nextTouchAt, na3.closed], ["lost", "Не выходит на связь", "", true]);
  const cb = ok(plan("callback", { comment: "после обеда" }))!;
  check("перезвонить: контакт, завтра, комментарий", [cb.touch.stage, cb.touch.nextTouchAt, cb.touch.comment], ["contact", "2026-10-06", "Перезвонить: после обеда"]);
  check("перезвонить на выбранный день", ok(plan("callback", { date: "2026-10-20" }))!.touch.nextTouchAt, "2026-10-20");
  const price = ok(plan("price_sent"))!;
  check("прайс: стадия «прайс / КП», через два дня", [price.touch.stage, price.touch.nextTouchAt], ["offer", "2026-10-07"]);
  check("прайс после пробного заказа стадию не откатывает", ok(plan("price_sent", {}, { stage: "trial", clientId: "C1" }))!.touch.stage, "trial");
  check("сезонно: через месяц по умолчанию", ok(plan("seasonal"))!.touch.nextTouchAt, "2026-11-04");
  check("заказ без карточки — отказ", plan("order"), "Сначала заведите клиента — без карточки заявку не оформить");
  check("заказ с карточкой — пробный", ok(plan("order", {}, { stage: "offer", clientId: "C1" }))!.touch.stage, "trial");
  const ni = ok(plan("not_interested", { reason: "Дорого" }))!;
  check("неинтересно: отказ с причиной", [ni.touch.stage, ni.touch.lostReason, ni.touch.comment], ["lost", "Дорого", "Неинтересно (дорого)"]);
  check("незнакомая причина — «Другое»", ok(plan("not_interested", { reason: "лень" }))!.touch.lostReason, "Другое");
  check("другой поставщик", ok(plan("other_supplier"))!.touch.lostReason, "Есть поставщик");
  check("не оптовик", ok(plan("retail"))!.touch.lostReason, "Не оптовик (розница)");
  check("неверный номер", ok(plan("wrong_number"))!.touch.lostReason, "Неверный контакт");
  check("незнакомый итог — отказ", plan("что-то"), "Выберите, чем закончился звонок");
  const allValid = CALL_OUTCOMES.map((o) => {
    const lead = o.key === "order" ? { stage: "offer", clientId: "C1" } : fresh0;
    const p = ok(plan(o.key, { reason: "Дорого" }, lead));
    return p ? touchRefusal(p.touch, lead, TODAY) : "нет плана";
  });
  check("каждый итог проходит общую проверку касания", allValid, CALL_OUTCOMES.map(() => ""));

  // --- Очередь менеджера ------------------------------------------------------------
  const L = (id: string, extra: Partial<Lead> = {}): Lead => ({
    leadId: id, createdAt: "2026-10-01T10:00:00", createdByEmail: "rop@x", name: id, city: "Алматы", contactPerson: "",
    phone: "+77010000000", clientType: "", source: "", address: "", note: "", managerEmail: "m1@x", stage: "new",
    stageChangedAt: "2026-10-01T10:00:00", nextTouchAt: "", lostReason: "", clientId: "", campaign: "Октябрь",
    segment: "Только заявка", history: "", firstSeenAt: "2026-01-01", pastOrders: 0, ...extra,
  });
  const T = (id: string, leadId: string, at: string, outcome: string, manager = "m1@x"): LeadTouch => ({
    touchId: id, leadId, createdAt: at, managerEmail: manager, channel: "Звонок", comment: outcome, stageFrom: "new",
    stageTo: "contact", nextTouchAt: "", outcome,
  });
  const leads = [
    L("NEW-OLD", { firstSeenAt: "2026-01-01" }),
    L("NEW-FRESH", { firstSeenAt: "2026-06-01" }),
    L("BOUGHT", { pastOrders: 6, segment: "Спящий" }),
    L("DUE-TODAY", { nextTouchAt: TODAY, stage: "contact" }),
    L("OVERDUE", { nextTouchAt: "2026-10-01", stage: "contact" }),
    L("LATER", { nextTouchAt: "2026-10-20", stage: "contact" }),
    L("CLOSED", { stage: "lost" }),
    L("OTHER", { campaign: "Сентябрь" }),
  ];
  const touches = [
    T("t1", "DUE-TODAY", "2026-10-04T09:00:00Z", "no_answer"),
    T("t2", "OVERDUE", "2026-09-30T09:00:00Z", "callback"),
  ];
  const q = buildCallQueue(leads, touches, TODAY, "Октябрь");
  check(
    "очередь: просроченный, сегодня, бывший покупатель, свежая заявка, старая",
    q.items.map((i) => i.leadId),
    ["OVERDUE", "DUE-TODAY", "BOUGHT", "NEW-FRESH", "NEW-OLD"]
  );
  check("счётчики очереди", [q.due, q.fresh, q.later], [2, 3, 1]);
  check("попытки дозвона видны", q.items.find((i) => i.leadId === "DUE-TODAY")!.attempts, 1);
  check("без фильтра обзвона — все мои", buildCallQueue(leads, touches, TODAY).items.length, 6);

  // --- Отчёт -----------------------------------------------------------------------
  const rLeads = [
    L("A", { managerEmail: "m1@x", stage: "offer" }),
    L("B", { managerEmail: "m1@x", stage: "lost" }),
    L("C", { managerEmail: "m2@x" }),
    L("D", { managerEmail: "" }),
    L("E", { managerEmail: "m2@x", stage: "contact", nextTouchAt: "2026-10-06" }),
    L("X", { campaign: "Сентябрь" }),
  ];
  const rTouches = [
    T("r1", "A", "2026-10-05T09:00:00Z", "no_answer"),
    T("r2", "A", "2026-10-05T09:00:10Z", "price_sent"),
    T("r3", "B", "2026-10-04T12:00:00Z", "retail"),
    T("r4", "E", "2026-10-03T12:00:00Z", "no_answer", "m2@x"),
    T("r5", "X", "2026-10-05T12:00:00Z", "order"),
    { ...T("r6", "C", "2026-10-05T10:00:00Z", ""), outcome: "" },
  ];
  const rep = buildCallReport({
    leads: rLeads,
    touches: rTouches,
    campaign: "Октябрь",
    today: TODAY,
    nameByEmail: new Map([["m1@x", "Эмиль"], ["m2@x", "Ильяс"], ["m3@x", "Юлия"]]),
    sellers: ["m1@x", "m2@x", "m3@x"],
  });
  check("в обзвоне, раздано, ничьих", [rep.leads, rep.assigned, rep.unassigned], [5, 4, 1]);
  check("позвонили / не звонили / дозвонились", [rep.called, rep.untouched, rep.reached], [3, 2, 2]);
  check("итог по ПОСЛЕДНЕМУ звонку", rep.byGroup, { none: 1, later: 0, interest: 1, refused: 0, notours: 1 });
  check("группы складываются в «позвонили»", Object.values(rep.byGroup).reduce((a, b) => a + b, 0), rep.called);
  check("звонки сегодня (обычное касание без итога не в счёт)", rep.callsToday, 2);
  const m1 = rep.managers.find((m) => m.email === "m1@x")!;
  check("менеджер: выдано, позвонил, быстрые отметки", [m1.assigned, m1.called, m1.fast, m1.callsToday], [2, 2, 1, 2]);
  check("кто без звонков сегодня при открытых клиентах", rep.silentToday, ["Ильяс"]);
  check("менеджер без базы — строка с нулями", rep.managers.find((m) => m.email === "m3@x")?.assigned, 0);
  check("лента: чужой обзвон не попадает, свежие сверху", rep.feed.map((f) => f.touchId), ["r2", "r1", "r3", "r4"]);

  console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
