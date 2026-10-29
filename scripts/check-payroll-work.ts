/**
 * Проверка выработки (этап 7 «Зарплаты»): виды работ и их синонимы из книги, разбор листов, хэш строки, сопоставление
 * имён, проверка дня, сводки и расчёт оплаты — сверено с листом «Расчёт заработной платы» книги Есентая за октябрь
 * 2026 (срезка 1 080 000 ₸ на четверых, уборка 100 000 по часам, подготовка по блок-секциям).
 *
 * Запуск: npx tsx scripts/check-payroll-work.ts
 */
import {
  areaForSheet,
  cleanBlock,
  cleanBudgetAmount,
  cleanWorkDay,
  cleanWorkRow,
  compareBlocks,
  computeAreaPay,
  deltaPercent,
  importWorkId,
  lastCrew,
  matchEmployeeByName,
  monthRange,
  parseWorkSheet,
  partOf,
  periodFor,
  plausibleDate,
  previousPeriod,
  recentPeople,
  shiftDay,
  summarizeArea,
  workHash,
  workTypeByLabel,
  type WorkBudget,
  type WorkEntry,
} from "../src/lib/payroll/work";
import { payrollScope } from "../src/lib/payroll/access";
import { greenhouseTabsFor } from "../src/app/greenhouse/tabs";
import { greenhouseScope } from "../src/lib/greenhouse/access";
import { payrollTabsFor } from "../src/app/payroll/tabs";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-10-29";

console.log("--- Виды работ из книги");
check("Срезка → cut", workTypeByLabel("cut", "Срезка")?.code, "cut");
check("«Основной бутон » → bud по часам", [workTypeByLabel("cut", "Основной бутон ")?.code, workTypeByLabel("cut", "Основной бутон ")?.basis], ["bud", "hours"]);
check("у сортировки бутон по штукам (так в листе расчёта)", workTypeByLabel("pack", "Центр-бутон")?.basis, "qty");
check("«Привоз арматуру » → rebar_bring", workTypeByLabel("prep", "Привоз арматуру ")?.code, "rebar_bring");
check("Уборка — по часам", workTypeByLabel("cut", "уборка")?.basis, "hours");
check("Ёлка: «Черенкование» с «ё»/«е»", workTypeByLabel("plant", "Черенкование")?.code, "cuttings");
check("незнакомое — null", workTypeByLabel("cut", "Полив"), null);
check("лист → участок", [areaForSheet("Учёт срезки"), areaForSheet("Учёт сортировки и упаковки"), areaForSheet("Учёт посадки"), areaForSheet("Учет подготовки"), areaForSheet("Черенкование")], ["cut", "pack", "plant", "prep", null]);
check("секция «1 секция » → 1", partOf("1 секция "), "1");
check("блок «7.0» → 7, «Маточник» как есть", [cleanBlock("7.0"), cleanBlock(" Маточник ")], ["7", "Маточник"]);
check("порядок блоков", ["Маточник", "10", "2", "Rose Farm", "1"].sort(compareBlocks), ["1", "2", "10", "Маточник", "Rose Farm"]);

console.log("--- Разбор листов");
const cutSheet = [
  ["Дата", "ФИО цветовода", "Блок", "Вид работ", "Кол-во", "Часов"],
  ["45448", "Конысбаева Гульмира", "7", "Срезка", "4000", "10"],
  ["25.10.2024", "Пайзова Саера Толыбаевна", "12", "Уборка", "", "4"],
  ["0202-06-29", "Жолманова Нурия Раховна", "9", "Упаковка", "505", ""],
  ["2026-10-24", "Жазыкбаев Нуржан Сарсенбайұлы", "8", "", "", "12"],
  ["2026-10-24", "Кто-то", "8", "Полив", "", "3"],
  ["2026-10-24", "", "8", "Срезка", "100", "3"],
  ["2026-10-20", "Умарова Юлдузхон Махсудбай кизи", "3", "Срезка", "2000", "8"],
  ["2026-10-20", "Умарова Юлдузхон Махсудбай кизи", "3", "Срезка", "2000", "8"],
];
const cut = parseWorkSheet("cut", cutSheet, TODAY);
check("серийная дата 45448 → 2024-06-05", cut.rows[0].date, "2024-06-05");
check("текстовая дата 25.10.2024", cut.rows[1].date, "2024-10-25");
check("уборка без количества — часы", [cut.rows[1].workType, cut.rows[1].qty, cut.rows[1].hours], ["cleanup", 0, 4]);
check("строка без вида с часами → прочие работы", [cut.rows[2].workType, cut.rows[2].hours], ["other", 12]);
check("две одинаковые строки — порядковые 1 и 2", [cut.rows[3].ordinal, cut.rows[4].ordinal], [1, 2]);
check("пропущено: дата 0202, Полив, без ФИО", cut.skipped.map((s) => s.line), [4, 6, 7]);
check("неизвестный вид посчитан", cut.unknownTypes, { Полив: 1 });
check("хэш одинаковых строк различается порядковым", importWorkId("esentai", cut.rows[3]) !== importWorkId("esentai", cut.rows[4]), true);
check("хэш устойчив", importWorkId("esentai", cut.rows[0]), importWorkId("esentai", { ...cut.rows[0] }));
check("хэш 16 знаков с X", /^X[0-9a-f]{16}$/.test(importWorkId("esentai", cut.rows[0])), true);
check("workHash разных строк различается", workHash("a") !== workHash("b"), true);

const prepSheet = [
  ["45474", "Махсатов Қанат Қайратұлы", "11", "3 секция", "1", "Натягивание сетки", "1"],
  ["2026-10-12", "Дауенова Инкар Онгарбаевна", "10", "1 секция ", "1", "Привоз арматуру ", "1"],
  ["0205-02-10", "Макулбаева Орынша Кдырбаевна", "11", "1 секция ", "1", "Привоз арматуру ", "1"],
];
const prep = parseWorkSheet("prep", prepSheet, TODAY);
check("подготовка без шапки: первая строка — данные", prep.rows.length, 2);
check("подготовка: блок, секция, вид, 1", [prep.rows[1].block, prep.rows[1].part, prep.rows[1].workType, prep.rows[1].qty], ["10", "1", "rebar_bring", 1]);
check("подготовка: дата 0205 пропущена", prep.skipped.length, 1);
check("дата из будущего неправдоподобна", [plausibleDate("2037-01-27", TODAY), plausibleDate("2026-10-30", TODAY), plausibleDate("2022-12-31", TODAY)], [false, true, false]);

console.log("--- Имена");
const employees = [
  { employeeId: "E1", fullName: "Умарова Юлдузхон Махсудбай кизи" },
  { employeeId: "E2", fullName: "Садуллаева Аккенже Ермагамбетовна" },
  { employeeId: "E3", fullName: "Ныгманова Марал Саясатовна" },
  { employeeId: "E4", fullName: "Иванова Анна Петровна" },
  { employeeId: "E5", fullName: "Иванова Анна Сергеевна" },
];
check("точное ФИО", matchEmployeeByName("умарова  юлдузхон махсудбай кизи", employees), "E1");
check("фамилия и имя, отчество с опечаткой", matchEmployeeByName("Ныгмановна  Марал Саясатова", employees), "");
check("фамилия и имя без отчества", matchEmployeeByName("Садуллаева Аккенже", employees), "E2");
check("двое с таким «фамилия имя» — не угадываем", matchEmployeeByName("Иванова Анна", employees), "");
check("привязка из PayrollWorkNames", matchEmployeeByName("Ныгмановна  Марал Саясатова", employees, [{ name: "Ныгмановна Марал Саясатова", employeeId: "E3" }]), "E3");
check("привязка на уволенного (нет в штате) — нет", matchEmployeeByName("Кто-то", employees, [{ name: "Кто-то", employeeId: "E9" }]), "");

console.log("--- Доступ и проверка дня");
const admin = payrollScope({ role: "admin", payrollRole: "", payrollDepartments: [] });
const head = payrollScope({ role: "payroll", payrollRole: "head", payrollDepartments: ["es-teplitsa"] });
const agro = payrollScope({ role: "payroll", payrollRole: "agronomist", payrollDepartments: [] });
const acc = payrollScope({ role: "payroll", payrollRole: "accountant", payrollDepartments: [] });
check("ввод: админ, начальник, бухгалтер — да; агроном — нет", [admin?.editsWork, head?.editsWork, acc?.editsWork, agro?.editsWork], [true, true, true, false]);
const ghHead = greenhouseScope({ role: "payroll", payrollRole: "head", payrollDepartments: ["es-teplitsa"] });
check("у начальника в «Теплице» — «Внести день» (там и выработка)", greenhouseTabsFor(ghHead, "esentai").some((t) => t.label === "Внести день"), true);
check("в «Зарплате» вкладки «Выработка» больше нет", payrollTabsFor(admin, "esentai").some((t) => t.label === "Выработка"), false);
check("вкладка с компанией и match без неё", greenhouseTabsFor(greenhouseScope({ role: "admin", payrollRole: "", payrollDepartments: [] }), "esentai").find((t) => t.label === "Внести день")?.match, ["/greenhouse/day"]);

const good = cleanWorkDay(admin, "cut", "2026-10-28", [{ workId: "", employeeId: "E1", block: "7", part: "", workType: "cut", qty: "4 000", hours: "10", note: "" }, { workId: "", employeeId: "E2", block: "7", part: "", workType: "cleanup", qty: "", hours: "4", note: "" }], employees, TODAY);
check("день: две строки чистые", [good.error, good.rows.length, good.rows[0].qty, good.rows[1].qty, good.rows[1].hours], ["", 2, 4000, 0, 4]);
check("день: уборка без часов — отказ", cleanWorkDay(admin, "cut", "2026-10-28", [{ workId: "", employeeId: "E1", block: "7", part: "", workType: "cleanup", qty: "", hours: "", note: "" }], employees, TODAY).error.includes("по часам"), true);
check("день: агроном — отказ", cleanWorkDay(agro, "cut", "2026-10-28", [], employees, TODAY).error.length > 0, true);
check("день: будущее — отказ", cleanWorkDay(admin, "cut", "2026-10-30", [], employees, TODAY).error.includes("будущ"), true);
check("день: чужой сотрудник — отказ", cleanWorkDay(admin, "cut", "2026-10-28", [{ workId: "", employeeId: "E9", block: "7", part: "", workType: "cut", qty: "10", hours: "", note: "" }], employees, TODAY).error.includes("не из штата"), true);
check("день: повтор строки — отказ", cleanWorkDay(admin, "cut", "2026-10-28", [{ workId: "", employeeId: "E1", block: "7", part: "", workType: "cut", qty: "10", hours: "", note: "" }, { workId: "", employeeId: "E1", block: "7", part: "", workType: "cut", qty: "20", hours: "", note: "" }], employees, TODAY).error.includes("повторяет"), true);
const legacy = cleanWorkDay(admin, "cut", "2026-10-28", [{ workId: "X1", employeeId: "", name: "Шегебаева Маржан Жамалиевна", block: "7", part: "", workType: "cut", qty: "500", hours: "6", note: "" }], employees, TODAY);
check("строка старого учёта без карточки правится по имени", [legacy.error, legacy.rows[0]?.employeeId, legacy.rows[0]?.name], ["", "", "Шегебаева Маржан Жамалиевна"]);
check("новая строка без карточки — отказ", cleanWorkDay(admin, "cut", "2026-10-28", [{ workId: "", employeeId: "", name: "Кто-то", block: "7", part: "", workType: "cut", qty: "500", hours: "6", note: "" }], employees, TODAY).error.includes("не выбран"), true);
check("подготовка без секции — отказ", cleanWorkRow("prep", { workId: "", employeeId: "E1", block: "10", part: "", workType: "net_up", qty: 1, hours: "", note: "" }).error.includes("секц"), true);
check("часы 25 — отказ", cleanWorkRow("cut", { workId: "", employeeId: "E1", block: "1", workType: "cut", part: "", qty: 10, hours: 25, note: "" }).error.length > 0, true);
check("пустая строка по штукам — отказ", cleanWorkRow("cut", { workId: "", employeeId: "E1", block: "1", workType: "cut", part: "", qty: "", hours: "", note: "" }).error.includes("пустая"), true);
check("бюджет «1 080 000» → 1080000; «-1» → null", [cleanBudgetAmount("1 080 000"), cleanBudgetAmount("-1"), cleanBudgetAmount("")], [1080000, null, 0]);

console.log("--- Периоды");
check("месяц → диапазон", monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
check("период по умолчанию — текущий месяц", periodFor(undefined, TODAY), { from: "2026-10-01", to: "2026-10-31", month: "2026-10" });
check("период from/to", periodFor({ from: "2026-10-05", to: "2026-10-01" }, TODAY), { from: "2026-10-01", to: "2026-10-05", month: "2026-10" });
check("период не длиннее года", periodFor({ from: "2024-01-01", to: "2026-10-01" }, TODAY).to, "2025-01-01");
check("прошлый период той же длины", previousPeriod("2026-10-01", "2026-10-31"), { from: "2026-08-31", to: "2026-09-30" });
check("сдвиг дня через месяц", shiftDay("2026-10-31", 1), "2026-11-01");
check("дельта", [deltaPercent(110, 100), deltaPercent(90, 100), deltaPercent(5, 0)], [10, -10, null]);

console.log("--- Сводка и оплата (октябрь 2026 из листа расчёта)");
const names = new Map(employees.map((e) => [e.employeeId, { fullName: e.fullName }]));
const E = (over: Partial<WorkEntry>): WorkEntry => ({ workId: "w", farm: "esentai", date: "2026-10-01", area: "cut", employeeId: "", name: "", block: "1", part: "", workType: "cut", qty: 0, hours: 0, note: "", createdBy: "", createdAt: "", updatedBy: "", updatedAt: "", ...over });
const cutEntries: WorkEntry[] = [
  E({ employeeId: "E1", qty: 84925, hours: 100, date: "2026-10-02" }),
  E({ employeeId: "E1", workType: "cleanup", hours: 15, date: "2026-10-03" }),
  E({ name: "Калдыбаева Жулдыз Бекбергеновна", qty: 75270, hours: 90, block: "2" }),
  E({ name: "Калдыбаева Жулдыз Бекбергеновна", workType: "cleanup", hours: 15 }),
  E({ name: "Аймуратова  Сарбиназ Ниетбаевна", qty: 85125, hours: 110 }),
  E({ name: "Аймуратова  Сарбиназ Ниетбаевна", workType: "cleanup", hours: 15 }),
  E({ name: "Шегебаева Маржан Жамалиевна", qty: 76775, hours: 95, block: "2" }),
  E({ name: "Шегебаева Маржан Жамалиевна", workType: "cleanup", hours: 15 }),
  E({ name: "Жазыкбаев Нуржан Сарсенбайұлы", workType: "other", hours: 12, block: "14" }),
];
const budgets: WorkBudget[] = [
  { month: "2026-10", farm: "esentai", area: "cut", workType: "cut", amount: 1080000, note: "", updatedBy: "", updatedAt: "" },
  { month: "2026-10", farm: "esentai", area: "cut", workType: "cleanup", amount: 100000, note: "", updatedBy: "", updatedAt: "" },
  { month: "2026-10", farm: "esentai", area: "cut", workType: "bud", amount: 50000, note: "", updatedBy: "", updatedAt: "" },
];
const pay = computeAreaPay("cut", cutEntries, budgets, names);
const row = (n: string) => pay.rows.find((r) => r.name.startsWith(n))!;
check("итого срезки 322 095", pay.columns.find((c) => c.workType === "cut")?.total, 322095);
check("Умарова: срезка 284 757,60", Math.round(row("Умарова").cells.cut.earned * 100) / 100, 284757.6);
check("Умарова: уборка 25 000 (15 ч из 60)", row("Умарова").cells.cleanup.earned, 25000);
check("Умарова ИТОГО 309 757,60", row("Умарова").total, 309757.6);
check("Калдыбаева 277 383,92", row("Калдыбаева").total, 277383.92);
check("Шегебаева 282 430,26", row("Шегебаева").total, 282430.26);
check("распределено = 1 180 000", pay.earnedTotal, 1180000);
check("бюджет бутона без выработки — нераспределён", pay.unspent, [{ workType: "bud", label: "Центр-бутон", amount: 50000 }]);
check("окладный с одними «прочими работами» в лист оплаты не попадает", [pay.rows.length, pay.rows.some((r) => r.name.startsWith("Жазыкбаев"))], [4, false]);
check("строки по убыванию ИТОГО", pay.rows.map((r) => r.name.split(" ")[0]).slice(0, 2), ["Аймуратова", "Умарова"]);

const prepEntries: WorkEntry[] = ["Макулбаева", "Абдиева", "Дауенова", "Кенгесбай"].flatMap((n) =>
  ["net_up", "crossbars", "leveling", "rebar_drive"].flatMap((t) => Array.from({ length: 6 }, (_, i) => E({ area: "prep", name: n, workType: t, qty: 1, block: String(10 + i), part: "1" }))),
);
const prepBudgets: WorkBudget[] = ["net_up", "crossbars", "leveling", "rebar_drive"].map((t) => ({ month: "2026-10", farm: "esentai", area: "prep", workType: t, amount: 280000, note: "", updatedBy: "", updatedAt: "" }));
const prepPay = computeAreaPay("prep", prepEntries, prepBudgets, names);
check("подготовка: по 6 блок-секций × 4 вида → 280 000 каждому", prepPay.rows.map((r) => r.total), [280000, 280000, 280000, 280000]);

const sum = summarizeArea("cut", cutEntries, names);
check("сводка: главный вид — срезка 322 095, 4 чел.", [sum.main?.qty, sum.main?.people], [322095, 4]);
check("сводка: стеблей в час 815,4", sum.main?.perHour, 815.4);
check("сводка: людей всего 5 (с окладным), человеко-дней", [sum.people.length, sum.personDays], [5, 6]);
check("сводка: имя из карточки", sum.people.find((p) => p.employeeId === "E1")?.name, "Умарова Юлдузхон Махсудбай кизи");
check("сводка: блоки по порядку", sum.blocks.map((b) => b.block), ["1", "2", "14"]);
check("сводка: виды в порядке участка", sum.types.map((t) => t.workType), ["cut", "cleanup", "other"]);
check("сводка: в час у человека", sum.people.find((p) => p.employeeId === "E1")?.perHour, 849.3);

console.log("--- Бригада и недавние");
const crewEntries = [E({ employeeId: "E1", date: "2026-10-27", block: "7" }), E({ employeeId: "E2", date: "2026-10-27", block: "7" }), E({ employeeId: "E2", date: "2026-10-27", block: "7" }), E({ employeeId: "E3", date: "2026-10-20", block: "3" }), E({ employeeId: "E4", date: "2026-10-28", block: "9" })];
check("состав последнего дня до 28-го — 27-е, без повторов", lastCrew("cut", crewEntries, "2026-10-28"), { date: "2026-10-27", rows: [{ employeeId: "E1", block: "7", part: "", workType: "cut" }, { employeeId: "E2", block: "7", part: "", workType: "cut" }] });
check("состава нет", lastCrew("pack", crewEntries, "2026-10-28"), null);
check("недавние — по свежести", recentPeople("cut", crewEntries, "2026-10-28"), ["E4", "E1", "E2", "E3"]);

console.log(fails ? `\nПЛОХО: ${fails}` : "\nВсё в порядке.");
if (fails) process.exit(1);
