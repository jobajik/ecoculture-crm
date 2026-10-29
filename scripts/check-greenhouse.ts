/**
 * Проверка раздела «Теплица» (29.10.2026): разбор листов книги агронома (Учёт цветка, Черенкование, Учёт брака,
 * Данные по датам), формулы листа «Данные по черенкованию по блокам» (посажено = факт − брак отделения − брак
 * рассадника − тех брак − выбраковка; с 7-го цикла — плюс черенки с маточника), сводки блока и цикла, права и меню.
 * Числа Altaj — живая строка книги: цикл 4, блок 4, инвойс 24 600, факт 25 720, брак 178 и 6 180, выбраковка 29 →
 * посажено 19 333.
 *
 * Запуск: npx tsx scripts/check-greenhouse.ts
 */
import {
  blockStatus,
  canonicalVariety,
  cleanCycle,
  cleanLogRow,
  cuttingKindOf,
  gradeOf,
  importLogId,
  logForSheet,
  parseCuttingsSheet,
  parseCyclesSheet,
  parseHarvestSheet,
  parseWasteSheet,
  plausibleWeight,
  sourceOf,
  summarizeBlock,
  summarizeCycles,
  summarizeVarieties,
  wasteKindOf,
  weightKgOf,
  currentCycleFor,
  type GhCutting,
  type GhCycle,
  type GhHarvest,
  type GhWaste,
} from "../src/lib/greenhouse/production";
import { blockInsights, cycleCard, cycleInsights, cycleOptions, cyclePhase, defaultCycle, finishedCycles, harvestBuckets, harvestInsight, heatValue, nowByBlock, previousFinished, qualitySplit, rankBlocks, rankVarieties, saneYield, weekStart, wasteByCycle } from "../src/lib/greenhouse/views";
import { greenhouseScope } from "../src/lib/greenhouse/access";
import { ghHref, pickGreenhouseFarm } from "../src/lib/greenhouse/farm";
import { greenhouseTabsFor } from "../src/app/greenhouse/tabs";
import { navLinksFor } from "../src/components/navLinks";
import { canOpen } from "../src/lib/access";
import { cleanBlock } from "../src/lib/payroll/work";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` — ждали ${JSON.stringify(want)}`}`);
}

const TODAY = "2026-10-29";
const FARM = "esentai";

console.log("--- Справочники");
check("категории книги", ["1", "2", "3", "4", "Высший", "Mini", "mini", "Brak", "Нераскрывшийся", "", "9"].map(gradeOf), ["Первая", "Вторая", "Третья", "Четвёртая", "Высшая", "Мини-микс", "Мини-микс", "Брак", "Нераскрывшийся", "", ""]);
check("сорт в одном написании", ["Ballerinas dark", "Karma PInk", "Chik", " altaj ", "Padolsk", "Новый сорт"].map((v) => canonicalVariety(v)), ["Ballerinas Dark", "Karma Pink", "Chic", "Altaj", "Podolsk", "Новый сорт"]);
check("виды черенкования", ["Приход по инвойсу", "Количество по факту", "Брак с отделения", "Брак с рассадника", "Выбраковка", "С маточника", "На маточник", "что-то"].map(cuttingKindOf), ["invoice", "actual", "dept_cull", "nursery_cull", "cull", "from_stock", "to_stock", null]);
check("причины брака", ["Повилика", "Тех брак", "клещ", "Тля", "ветер"].map(wasteKindOf), ["dodder", "tech", "mite", "aphid", null]);
check("вес из книги", [weightKgOf("29 кг"), weightKgOf("7, 6"), weightKgOf(338.2), weightKgOf(""), weightKgOf("abc")], [29, 7.6, 338.2, 0, 0]);
check("вес правдоподобен 10–400 г", [plausibleWeight(195, 18), plausibleWeight(100, 45327), plausibleWeight(100, 0.5), plausibleWeight(0, 5)], [true, false, false, false]);
check("блок RoseFarm — одно написание", [cleanBlock("RoseFarm "), cleanBlock("rose farm"), cleanBlock("4.0"), cleanBlock("маточник")], ["Rose Farm", "Rose Farm", "4", "Маточник"]);
check("листы книги", ["Учёт цветка", "Черенкование", "Учет отбракованного товара на т", "Данные по датам", "Процент брака", "Данные по черенкованию по блока", "Учёт срезки"].map(logForSheet), ["harvest", "cuttings", "waste", "cycles", null, null, null]);

console.log("--- Проверка строки");
const ok = cleanLogRow("harvest", { id: "", date: "2026-10-24", cycle: "11", block: "8.0", variety: "altaj", kind: "1", qty: "1 200", weightKg: "96" }, TODAY);
check("срезка: чистая строка", ok.row && [ok.row.date, ok.row.cycle, ok.row.block, ok.row.variety, ok.row.kind, ok.row.qty, ok.row.weightKg], ["2026-10-24", 11, "8", "Altaj", "Первая", 1200, 96]);
check("отказы", [
  cleanLogRow("harvest", { id: "", date: "2026-10-30", cycle: 11, block: "8", variety: "Altaj", kind: "1", qty: 5 }, TODAY).error,
  cleanLogRow("harvest", { id: "", date: "2026-10-20", cycle: "", block: "8", variety: "Altaj", kind: "1", qty: 5 }, TODAY).error,
  cleanLogRow("harvest", { id: "", date: "2026-10-20", cycle: 11, block: "", variety: "Altaj", kind: "1", qty: 5 }, TODAY).error,
  cleanLogRow("harvest", { id: "", date: "2026-10-20", cycle: 11, block: "8", variety: "Altaj", kind: "Высочайшая", qty: 5 }, TODAY).error,
  cleanLogRow("cuttings", { id: "", date: "2026-10-20", cycle: 11, block: "8", variety: "Altaj", kind: "invoice", qty: 0 }, TODAY).error,
  cleanLogRow("waste", { id: "", date: "2026-10-20", cycle: 11, block: "8", variety: "Altaj", kind: "ветер", qty: 3 }, TODAY).error,
], ["дата из будущего", "не указан цикл", "не указан блок", "не указана категория", "количество больше нуля", "не указана причина брака"]);
check("даты цикла", [cleanCycle({ cycle: "12", block: "2", cuttingsAt: "20.07.2026", plantedAt: "2026-08-30", plannedHarvestAt: "", note: "" }).cycle?.cuttingsAt, cleanCycle({ cycle: "12", block: "2", cuttingsAt: "2026-09-01", plantedAt: "2026-08-30", plannedHarvestAt: "", note: "" }).error], ["2026-07-20", "Посадка раньше черенкования."]);

console.log("--- Разбор листов");
const harvestSheet = [
  ["Дата", "Блок", "Сорт", "Кол-во", "Категория", "Вес", "Цикл"],
  ["45389", "4", "Fianna", "195", "1", "18", "2"],
  ["45389", "4", "Fianna", "195", "1", "18", "2"], // точный повтор — вторая строка, свой номер
  ["2024-04-07", "4", "Kennedy", "5295", "3", "155", "2"],
  ["2024-04-07", "4", "Kennedy", "100", "Высший", "", ""], // без цикла — пропуск
  ["", "", "", "", "", "", ""],
];
const hp = parseHarvestSheet(harvestSheet, TODAY);
check("срезка: строк и пропусков", [hp.rows.length, hp.skipped.length, hp.skipped[0]?.why], [3, 1, "не указан цикл"]);
check("срезка: серийная дата и категория", [hp.rows[0].date, hp.rows[0].kind, hp.rows[0].weightKg], ["2024-04-07", "Первая", 18]);
check("повтор строки — разные номера", importLogId(FARM, "harvest", hp.rows[0]) !== importLogId(FARM, "harvest", hp.rows[1]), true);
check("номер строки стабилен", importLogId(FARM, "harvest", hp.rows[0]) === importLogId(FARM, "harvest", parseHarvestSheet(harvestSheet, TODAY).rows[0]), true);

const cuttingsSheet = [
  ["Цикл", "Дата черенкования ", "Сорт", "Номер недели", "Тип учета", "Количество", "Блок", "Секция", "линия"],
  ["4", "2024-08-20", "Altaj", "34", "Приход по инвойсу", "24600", "4", "", ""],
  ["4", "2024-08-20", "Altaj", "34", "Количество по факту", "25720", "4", "", ""],
  ["4", "2024-08-22", "Altaj", "34", "Брак с отделения", "178", "4", "", ""],
  ["4", "2024-08-22", "Altaj", "34", "Брак с рассадника", "6180", "4", "", ""],
  ["4", "2024-08-25", "Altaj", "35", "Выбраковка", "29", "4", "2", "5"],
  ["4", "2024-08-25", "Altaj", "35", "Выбраковка", "0", "4", "", ""], // ноль — не запись, без жалобы
  ["4", "2024-08-20", "Altaj", "34", "На маточник", "300", "", "", ""], // без блока — «весь цикл»
];
const cp = parseCuttingsSheet(cuttingsSheet, TODAY);
check("черенкование: строк, пропусков", [cp.rows.length, cp.skipped.length], [6, 0]);
check("черенкование: секция и линия, блок без номера", [cp.rows[4].part, cp.rows[4].line, cp.rows[5].block], ["2", "5", "—"]);

const wasteSheet = [
  ["Цикл", "Дата брака", "Блок", "Сорт", "Кол-во", "Тип брака"],
  ["4", "2024-10-01", "4", "Altaj", "588", "Повилика"],
  ["4", "2024-10-02", "4", "Altaj", "40", "Тех брак"],
  ["4", "", "4", "Altaj", "10", "Повилика"],
];
const wp = parseWasteSheet(wasteSheet, TODAY);
check("брак: строк и пропусков", [wp.rows.length, wp.skipped.length], [2, 1]);

const cyclesSheet = [
  ["Цикл", "Блок", "Дата черенкования", "Дата посадки:", "дата планиуемой срезки"],
  ["4", "4", "2024-08-20", "2024-09-05", "2024-11-20"],
  ["12", "2", "2026-07-20", "2026-08-30", ""],
  ["13", "RoseFarm ", "2026-10-22", "", ""],
  ["13", "RoseFarm", "2026-10-29", "", ""],
];
const yp = parseCyclesSheet(cyclesSheet);
check("даты по циклам: повтор блока пропущен", [yp.rows.length, yp.skipped[0]?.why, yp.rows[2].block], [3, "цикл и блок повторяются", "Rose Farm"]);

console.log("--- Блок: формулы книги");
const mk = <T>(rows: T[]) => rows;
const cycles: GhCycle[] = yp.rows.map((c) => ({ ...c, farm: FARM, updatedBy: "", updatedAt: "" }));
const cuttings: GhCutting[] = cp.rows.map((r, i) => ({ id: `c${i}`, farm: FARM, cycle: r.cycle, date: r.date, block: r.block, part: r.part, line: r.line, variety: r.variety, kind: r.kind, qty: r.qty, note: "" }));
// Тех брак в журнале брака тоже уменьшает посадку — но в книжной строке его 0; сравниваем без него.
const waste: GhWaste[] = wp.rows.filter((r) => r.kind !== "tech").map((r, i) => ({ id: `w${i}`, farm: FARM, date: r.date, cycle: r.cycle, block: r.block, variety: r.variety, qty: r.qty, kind: r.kind, note: "" }));
const harvest: GhHarvest[] = mk([
  { id: "h1", farm: FARM, date: "2024-11-25", cycle: 4, block: "4", variety: "Altaj", grade: "Первая", qty: 10000, weightKg: 800, note: "" },
  { id: "h2", farm: FARM, date: "2024-11-28", cycle: 4, block: "4", variety: "Altaj", grade: "Третья", qty: 5435, weightKg: 0, note: "" },
  { id: "h3", farm: FARM, date: "2024-11-28", cycle: 4, block: "4", variety: "Altaj", grade: "Вторая", qty: 0, weightKg: 0, note: "" },
  { id: "h4", farm: FARM, date: "2024-11-29", cycle: 4, block: "4", variety: "Altaj", grade: "Брак", qty: 100, weightKg: 45327, note: "" }, // вес с лишними нулями — не в счёт
]).filter((h) => h.qty > 0);
const data = { cycles, harvest, cuttings, waste };
const b = summarizeBlock(4, "4", data, TODAY);
const altaj = b.varieties.find((v) => v.variety === "Altaj")!;
check("Altaj: инвойс, факт, % лишних, брак, выбраковка", [altaj.invoice, altaj.actual, altaj.extraPct, altaj.deptCull, altaj.nurseryCull, altaj.cull], [24600, 25720, 104.6, 178, 6180, 29]);
check("Altaj: посажено как в книге", altaj.planted, 19333);
check("Altaj: срезано, остаток, выход", [altaj.harvested, altaj.remaining, altaj.yieldPct], [15535, 3798, 80.4]);
check("вес — только правдоподобные строки", [altaj.avgWeight, b.totals.weightByGrade["Первая"], b.totals.weightByGrade["Брак"]], [80, 80, undefined]);
check("категории блока по порядку, доля высшей+первой", [b.grades, b.topShare], [["Первая", "Третья", "Брак"], 64.4]);
check("брак на блоке по причинам", [altaj.wasteByKind, altaj.wasteTotal], [{ dodder: 588 }, 588]);
check("блок завершён (срезка 2024-го)", b.status, "done");
check("«на маточник» без блока в блок не идёт", altaj.toStock, 0);

// Тех брак из журнала брака уменьшает посадку.
const withTech = summarizeBlock(4, "4", { ...data, waste: wp.rows.map((r, i) => ({ id: `w${i}`, farm: FARM, date: r.date, cycle: r.cycle, block: r.block, variety: r.variety, qty: r.qty, kind: r.kind, note: "" })) }, TODAY);
check("тех брак уменьшает посадку", withTech.varieties[0].planted, 19293);

// С 7-го цикла посадка «С маточника» без инвойса и факта.
const stock = summarizeBlock(9, "3", { cycles: [], harvest: [], waste: [], cuttings: [{ id: "s1", farm: FARM, cycle: 9, date: "2025-10-01", block: "3", part: "", line: "", variety: "Bacardi", kind: "from_stock", qty: 50000, note: "" }, { id: "s2", farm: FARM, cycle: 9, date: "2025-10-05", block: "3", part: "", line: "", variety: "Bacardi", kind: "cull", qty: 1200, note: "" }] }, TODAY);
check("с маточника — посажено", stock.totals.planted, 48800);
check("пришло: факт, иначе инвойс, плюс маточник", [sourceOf({ actual: 10, invoice: 9, fromStock: 5 }), sourceOf({ actual: 0, invoice: 9, fromStock: 5 })], [15, 14]);

console.log("--- Состояние и сроки");
check("состояния", [
  blockStatus({ cuttingsAt: "2026-10-14", plantedAt: "" }, "", "", true, TODAY),
  blockStatus({ cuttingsAt: "2026-07-20", plantedAt: "2026-08-30" }, "", "", true, TODAY),
  blockStatus({ cuttingsAt: "", plantedAt: "" }, "2026-10-10", "2026-10-24", true, TODAY),
  blockStatus({ cuttingsAt: "", plantedAt: "" }, "2026-08-01", "2026-09-01", true, TODAY),
  blockStatus({ cuttingsAt: "2026-11-05", plantedAt: "" }, "", "", false, TODAY),
  blockStatus({ cuttingsAt: "", plantedAt: "" }, "", "", false, TODAY),
  blockStatus({ cuttingsAt: "2025-06-01", plantedAt: "2025-06-22" }, "", "", true, TODAY),
], ["cuttings", "growing", "harvest", "done", "planned", "empty", "noharvest"]);
check("выход растущего блока — не «0 %», а пусто", summarizeBlock(12, "2", data, TODAY).totals.yieldPct, null);
const growing = summarizeBlock(12, "2", data, TODAY);
check("срезка ≈ посадка + 76 дней, если плана нет", [growing.expectedHarvestAt, growing.expectedIsEstimate, growing.status], ["2026-11-14", true, "growing"]);
check("план из книги — как есть", [b.expectedHarvestAt, b.expectedIsEstimate], ["2024-11-20", false]);
check("текущий цикл блока на дату", [currentCycleFor("2", TODAY, data), currentCycleFor("4", TODAY, data)], [12, 4]);

console.log("--- Циклы, сорта, вид");
const rows = summarizeCycles(data, TODAY);
check("циклы новыми первыми", rows.map((r) => r.cycle), [13, 12, 4]);
check("цикл 4: посажено и срезано", [rows[2].planted, rows[2].harvested], [19333, 15535]);
const cards = rows.map((r) => cycleCard(r, TODAY));
check("по умолчанию — цикл со срезкой", defaultCycle(cards), 4);
check("по умолчанию — режущийся цикл важнее", defaultCycle([{ cycle: 11, blocks: [{ status: "harvest", harvested: 10 }] }, { cycle: 12, blocks: [{ status: "growing", harvested: 0 }] }, { cycle: 10, blocks: [{ status: "done", harvested: 99 }] }]), 11);
const now = nowByBlock(cards);
check("сейчас: блок 2 — цикл 12 растёт, Rose Farm — 13", [now.find((x) => x.block === "2")?.cycle, now.find((x) => x.block === "2")?.status, now.find((x) => x.block === "Rose Farm")?.status], [12, "growing", "cuttings"]);
const card4 = cards[2].blocks[0];
check("карточка блока: отход при посадке", card4.plantingLossPct, 24.8);
check("тепловая карта: выход и вес", [heatValue(card4, "yield"), heatValue(card4, "weight"), heatValue(cards[1].blocks[0], "yield")], [80.4, 80, null]);
check("сорта поверх циклов", summarizeVarieties(rows).map((v) => [v.variety, v.planted, v.harvested, v.yieldPct]), [["Altaj", 19333, 15535, 80.4]]);
check("неделя с понедельника", [weekStart("2026-10-29"), weekStart("2026-10-26"), weekStart("2026-11-01")], ["2026-10-26", "2026-10-26", "2026-10-26"]);
check("срезка по месяцам", harvestBuckets(harvest, "2024-01-01", TODAY, "month").map((x) => [x.key, x.total]), [["2024-11", 15535]]);
check("брак по циклам", wasteByCycle(waste), [{ cycle: 4, total: 588, byKind: { dodder: 588 } }]);

console.log("--- Простой вид: цикл списком, качество тремя группами, рейтинги");
check("качество тремя группами", qualitySplit([{ grade: "Высшая", qty: 10 }, { grade: "Первая", qty: 30 }, { grade: "Третья", qty: 40 }, { grade: "Брак", qty: 20 }]).map((q) => [q.label, q.pct]), [["Высшая и 1-я", 40], ["2-я и 3-я", 40], ["4-я, мини и брак", 20]]);
check("фазы циклов", cards.map((c) => [c.cycle, cyclePhase(c)]), [[13, "cuttings"], [12, "growing"], [4, "done"]]);
check("пункты выбора: текущий помечен", cycleOptions(cards).map((o) => o.label), ["Цикл 13 — черенкование", "Цикл 12 — растёт", "Цикл 4 — завершён · текущий"]);
const live = [
  { ...cards[2], cycle: 11, blocks: cards[2].blocks.map((b) => ({ ...b, cycle: 11, status: "harvest" as const })) },
  { ...cards[2], cycle: 10 },
  { ...cards[2], cycle: 9, yieldPct: 70, topShare: 50 },
];
check("текущий — тот, что режется", cycleOptions(live).find((o) => o.current)?.cycle, 11);
check("прошлый ЗАВЕРШЁННЫЙ для сравнения", [previousFinished(live, 11)?.cycle, previousFinished(live, 10)?.cycle], [10, 9]);
check("завершённые циклы", finishedCycles(live).map((c) => c.cycle), [10, 9]);
check("выход > 130 % в рейтинг не идёт", [saneYield(98), saneYield(214), saneYield(null)], [98, null, null]);
const rb = rankBlocks([cards[2], { ...cards[1] }]);
check("рейтинг блоков: завершённый с выходом, растущий — пометкой", rb.map((r) => [r.label, r.yieldPct, r.note]), [["Блок 4", 80.4, ""], ["Блок 2", null, "растёт"]]);
check("рейтинг блоков по живому циклу: идёт срезка", rankBlocks([live[0]]).map((r) => r.note), ["идёт срезка"]);
check("сорта: посадка не записана — без выхода", rankVarieties(rows, 3000).map((r) => [r.label, r.yieldPct, r.harvested]), [["Altaj", 80.4, 15535]]);
const two = [
  { key: "1", label: "Блок 1", planted: 100, harvested: 90, yieldPct: 90, topShare: 40, avgWeight: 70, cycles: 1, quality: [], note: "" },
  { key: "2", label: "Блок 2", planted: 100, harvested: 60, yieldPct: 60, topShare: 20, avgWeight: 60, cycles: 1, quality: [], note: "" },
];
check("выводы по блокам словами", blockInsights(two)[0], "Лучший выход — Блок 1: 90 %, слабее всех — Блок 2: 60 %.");
check("выводы по циклам", cycleInsights([{ ...cards[2], cycle: 10, yieldPct: 82, topShare: 30 }, { ...cards[2], cycle: 9, yieldPct: 78, topShare: 35 }])[0], "Цикл 10: выход 82 % — на 4 п. лучше, чем в цикле 9.");
check("вывод по срезке", harvestInsight([{ key: "2026-09", label: "", total: 100000, byGrade: {} }, { key: "2026-10", label: "", total: 120000, byGrade: {} }], "month")?.replace(/\s/g, " "), "За последний месяц срезали 120 000 шт. — на 20 % больше, чем за предыдущий.");

console.log("--- Права, компания, меню");
const admin = greenhouseScope({ role: "admin", payrollRole: "", payrollDepartments: [] });
const agro = greenhouseScope({ role: "agronomist", farm: "esentai", payrollRole: "", payrollDepartments: [] });
const agroNoFarm = greenhouseScope({ role: "agronomist", farm: "", payrollRole: "", payrollDepartments: [] });
const manager = greenhouseScope({ role: "manager", payrollRole: "", payrollDepartments: [] });
const head = greenhouseScope({ role: "payroll", payrollRole: "head", payrollDepartments: ["es-teplitsa"] });
const hr = greenhouseScope({ role: "payroll", payrollRole: "hr", payrollDepartments: [] });
const accountant = greenhouseScope({ role: "accountant", payrollRole: "", payrollDepartments: [] });
check("админ — всё", admin && [admin.editsLogs, admin.editsWork, admin.seesMoney, admin.farmLocked], [true, true, true, null]);
check("агроном — журналы своего производства, без выработки", agro && [agro.editsLogs, agro.editsWork, agro.farmLocked, !!agro.payroll], [true, false, "esentai", false]);
check("агроном без производства — закрыто (грабли 1.10)", agroNoFarm, null);
check("менеджер без роли модуля — закрыто", manager, null);
check("бригадир (роль модуля «начальник») — журналы и выработка", head && [head.editsLogs, head.editsWork, head.seesMoney], [true, true, false]);
check("кадровику теплица ни к чему", hr, null);
check("бухгалтер — смотрит", accountant && [accountant.editsLogs, accountant.editsWork], [false, false]);
check("вкладки агронома — без выработки", greenhouseTabsFor(agro, "esentai").map((t) => t.label), ["Циклы и блоки", "Срезка", "Черенкование", "Брак", "Аналитика"]);
check("вкладки админа — с выработкой", greenhouseTabsFor(admin, "esentai").map((t) => t.label), ["Циклы и блоки", "Срезка", "Черенкование", "Брак", "Аналитика", "Выработка"]);
check("компания: закреплённая главнее адреса, по умолчанию Есентай", [pickGreenhouseFarm("rose_farm", undefined, "esentai"), pickGreenhouseFarm(undefined, undefined), pickGreenhouseFarm(undefined, "rose_farm"), pickGreenhouseFarm("all", "esentai")], ["esentai", "esentai", "rose_farm", "esentai"]);
check("адрес с компанией", ghHref("/greenhouse", "esentai", { cycle: 11, block: "" }), "/greenhouse?cycle=11&farm=esentai");
check("меню: «Теплица» у админа — рабочий раздел", navLinksFor("admin").find((l) => l.label === "Теплица")?.other, false);
check("меню: агроном видит «Теплицу»", navLinksFor("agronomist", "", [], "esentai").some((l) => l.label === "Теплица"), true);
check("меню: агроном без производства — нет", navLinksFor("agronomist").some((l) => l.label === "Теплица"), false);
check("меню: у менеджера нет", navLinksFor("manager").some((l) => l.label === "Теплица"), false);
check("меню: бригадир — «Теплица» и «Зарплата»", navLinksFor("payroll", "head", ["es-teplitsa"]).map((l) => l.label), ["Теплица", "Зарплата"]);
check("охранник пускает агронома, склад и бригадира", [canOpen("agronomist", "/greenhouse"), canOpen("warehouse", "/greenhouse/harvest"), canOpen("payroll", "/greenhouse/work")], [true, true, true]);

if (failed) {
  console.log(`\nНе прошло: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли.");
