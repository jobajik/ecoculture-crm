/**
 * Проверка правил модуля «Зарплата» — доступ, справочники, ставки, баланс.
 *
 * Что ломается молча, если эти правила разъедутся: начальник одного подразделения видит чужих людей или оклады;
 * строка Users с опечаткой в роли открывает доступ вместо того, чтобы закрыть; ставка с датой в середине месяца
 * применяется к месяцу, который начался раньше неё; норма шестидневки берётся у пятидневки.
 *
 * Запуск: npx tsx scripts/check-payroll.ts
 */
import { payrollScope, seesDepartment, cleanDeptId } from "../src/lib/payroll/access";
import {
  accessRefusal,
  balanceRefusal,
  cleanEmployee,
  departmentRefusal,
  employedIn,
  employeeRefusal,
  kpiOf,
  normHours,
  normDays,
  rateFor,
  rateRefusal,
  suggestBalance,
} from "../src/lib/payroll/rules";
import type { Department, Employee, Rate } from "../src/lib/payroll/types";
import { monthFromTitle, parseStaffingMatrix, planStaffingImport } from "../src/lib/payroll/staffingImport";
import { addDays, compareWithIsDayOff, isDayOff, isHoliday, lawHolidays, monthNorm, nonWorkingDays, yearNorm, type ExtraDay } from "../src/lib/payroll/calendarKz";
import { payrollTabsFor } from "../src/app/payroll/tabs";
import {
  applyFired,
  cleanRowCells,
  dayInfos,
  dayShiftHours,
  decodeDays,
  encodeDays,
  fillBySchedule,
  monthLabel,
  nextStatus,
  normalizeCell,
  shiftMonth,
  summarizeRow,
  timesheetEditRefusal,
  timesheetMoveRefusal,
  timesheetPeople,
} from "../src/lib/payroll/timesheet";
import { navLinksFor } from "../src/components/navLinks";
import { EMPTY_ADJUSTMENT, adjustmentIsEmpty, adjustmentRefusal, advanceHalf, cleanAdjustment, computePayslip, employmentFraction, sumRows, type PayslipInput } from "../src/lib/payroll/payslip";
import { canOpen } from "../src/lib/access";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
function refuses(name: string, refusal: string) {
  check(name, refusal.length > 0, true);
}
function allows(name: string, refusal: string) {
  check(name, refusal, "");
}

// --- Доступ -----------------------------------------------------------------
const admin = payrollScope({ role: "admin", payrollRole: "", payrollDepartments: [] })!;
const accountant = payrollScope({ role: "payroll", payrollRole: "accountant", payrollDepartments: [] })!;
const hr = payrollScope({ role: "payroll", payrollRole: "hr", payrollDepartments: [] })!;
const agro = payrollScope({ role: "agronomist", payrollRole: "agronomist", payrollDepartments: [] })!;
const head = payrollScope({ role: "payroll", payrollRole: "head", payrollDepartments: ["teplitsa"] })!;

check("админ — всё", [admin.seesMoney, admin.editsEmployees, admin.editsRates, admin.editsAccess], [true, true, true, true]);
check("бухгалтер: суммы и ставки, не сотрудники", [accountant.seesMoney, accountant.editsRates, accountant.editsEmployees, accountant.editsAccess], [true, true, false, false]);
check("кадровик: сотрудники и суммы, не ставки", [hr.seesMoney, hr.editsEmployees, hr.editsRates], [true, true, false]);
check("агроном: только смотрит, суммы видит", [agro.seesMoney, agro.editsEmployees, agro.editsRates], [true, false, false]);
check("начальник: своё подразделение, без сумм", [head.seesMoney, head.departments], [false, ["teplitsa"]]);
check("начальник без подразделений — доступа нет (ошибка закрывает)", payrollScope({ role: "payroll", payrollRole: "head", payrollDepartments: [] }), null);
check("опечатка в роли — доступа нет", payrollScope({ role: "manager", payrollRole: "acountant", payrollDepartments: [] }), null);
check("без роли CRM — доступа нет даже с ролью модуля", payrollScope({ role: "", payrollRole: "accountant", payrollDepartments: [] }), null);
check("менеджер без роли модуля — доступа нет", payrollScope({ role: "manager", payrollRole: "", payrollDepartments: [] }), null);
check("начальник видит своё", seesDepartment(head, "teplitsa"), true);
check("начальник не видит чужое", seesDepartment(head, "security"), false);
check("бухгалтер видит все", seesDepartment(accountant, "security"), true);
check("код подразделения чистится", cleanDeptId(" Теплица/Rose Farm "), "rose-farm");
check("вкладки начальника — табель и сотрудники", payrollTabsFor(head).map((t) => t.label), ["Табель", "Сотрудники"]);
check("вкладки админа — с доступом", payrollTabsFor(admin).map((t) => t.label), ["Табель", "Сотрудники", "Ведомость", "Подразделения", "Календарь и нормы", "Доступ"]);
check("вкладки бухгалтера — без доступа", payrollTabsFor(accountant).map((t) => t.label), ["Табель", "Сотрудники", "Ведомость", "Подразделения", "Календарь и нормы"]);

// --- Меню и охранник --------------------------------------------------------
check("у админа есть «Зарплата» (в группе «Прочее»)", navLinksFor("admin").find((l) => l.label === "Зарплата")?.other, true);
check("у менеджера без роли модуля «Зарплаты» нет", navLinksFor("manager").some((l) => l.label === "Зарплата"), false);
check("у менеджера-начальника «Зарплата» — рабочий раздел", navLinksFor("manager", "head", ["teplitsa"]).find((l) => l.label === "Зарплата")?.other, false);
check("у «только зарплата» — один раздел", navLinksFor("payroll", "hr", []).map((l) => l.label), ["Зарплата"]);
check("у «только зарплата» без роли модуля меню пустое", navLinksFor("payroll").length, 0);
check("охранник пускает «только зарплату» в /payroll", canOpen("payroll", "/payroll/employees"), true);
check("охранник не пускает «только зарплату» в заявки", canOpen("payroll", "/orders"), false);
check("охранник не пускает «только зарплату» в настройки", canOpen("payroll", "/admin"), false);
check("охранник пускает менеджера в /payroll (решает роль модуля)", canOpen("manager", "/payroll"), true);

// --- Подразделения ------------------------------------------------------------
const depts: Department[] = [
  { deptId: "teplitsa", farm: "rose_farm", name: "Теплица", order: 1, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true },
  { deptId: "assembly", farm: "rose_farm", name: "Сборка готовой продукции", order: 2, workWeek: 6, overtime: true, overtimeRate: 0.5, note: "", active: true },
];
allows("подразделение заводится", departmentRefusal(admin, depts, { deptId: "security", farm: "rose_farm", name: "Охрана", order: 3, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));
refuses("без кода нельзя", departmentRefusal(admin, depts, { deptId: "", farm: "rose_farm", name: "Охрана", order: 3, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));
refuses("то же название под другим кодом — двойник", departmentRefusal(admin, depts, { deptId: "tepl", farm: "rose_farm", name: "теплица", order: 3, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));
allows("своё название под своим кодом — правка", departmentRefusal(admin, depts, { deptId: "teplitsa", farm: "rose_farm", name: "Теплица", order: 1, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));
refuses("без компании (ТОО) нельзя", departmentRefusal(admin, depts, { deptId: "x", farm: "", name: "X", order: 1, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));
refuses("выдуманная компания — отказ", departmentRefusal(admin, depts, { deptId: "x", farm: "zao", name: "X", order: 1, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));
refuses("сверхурочные без коэффициента", departmentRefusal(admin, depts, { deptId: "x", farm: "rose_farm", name: "X", order: 1, workWeek: 5, overtime: true, overtimeRate: 0, note: "", active: true }));
refuses("бухгалтер подразделения не заводит", departmentRefusal(accountant, depts, { deptId: "x", farm: "rose_farm", name: "X", order: 1, workWeek: 5, overtime: false, overtimeRate: 0, note: "", active: true }));

// --- Сотрудники ---------------------------------------------------------------
const emp = (p: Partial<Employee> & { employeeId: string; fullName: string }): Employee => ({
  deptId: "teplitsa",
  position: "Цветовод",
  employment: "td",
  payType: "month",
  hiredAt: "2024-01-10",
  firedAt: "",
  travelAddress: "",
  travelRate: 0,
  iin: "",
  note: "",
  createdAt: "",
  createdBy: "",
  updatedAt: "",
  updatedBy: "",
  ...p,
});
const employees = [emp({ employeeId: "E1", fullName: "Шамуратова Гуласал Янгибаевна" }), emp({ employeeId: "E2", fullName: "Иванов Иван", firedAt: "2024-05-31" })];
const ctx = { departments: depts, employees };
const draft = {
  employeeId: "",
  fullName: "  Нурлаева   Маржаной ",
  deptId: "teplitsa",
  position: "Цветовод",
  employment: "td",
  payType: "",
  hiredAt: "2026-11-01",
  firedAt: "",
  travelAddress: "",
  travelRate: 0,
  iin: "",
  note: "",
};
allows("кадровик заводит сотрудника", employeeRefusal(hr, ctx, draft));
check("ФИО и тип расчёта чистятся", [cleanEmployee(draft).fullName, cleanEmployee(draft).payType], ["Нурлаева Маржаной", "month"]);
refuses("бухгалтер сотрудников не заводит", employeeRefusal(accountant, ctx, draft));
refuses("начальник сотрудников не заводит", employeeRefusal(head, ctx, draft));
refuses("без подразделения", employeeRefusal(hr, ctx, { ...draft, deptId: "" }));
refuses("несуществующее подразделение", employeeRefusal(hr, ctx, { ...draft, deptId: "nope" }));
refuses("без должности", employeeRefusal(hr, ctx, { ...draft, position: "" }));
refuses("вид занятости не из списка", employeeRefusal(hr, ctx, { ...draft, employment: "договор" }));
refuses("увольнение раньше приёма", employeeRefusal(hr, ctx, { ...draft, firedAt: "2026-10-01" }));
refuses("дата не по форме", employeeRefusal(hr, ctx, { ...draft, hiredAt: "01.11.2026" }));
refuses("дорожные без адреса", employeeRefusal(hr, ctx, { ...draft, travelRate: 500 }));
refuses("ИИН не из 12 цифр", employeeRefusal(hr, ctx, { ...draft, iin: "12345" }));
check("ИИН с пробелами чистится", cleanEmployee({ ...draft, iin: "123 456 789 012" }).iin, "123456789012");
refuses("двойник работающего — по ФИО без учёта регистра и ё", employeeRefusal(hr, ctx, { ...draft, fullName: "шамуратова гуласал янгибаевна" }));
allows("уволенный двойником не считается", employeeRefusal(hr, ctx, { ...draft, fullName: "Иванов Иван" }));
allows("правка своей же карточки — не двойник", employeeRefusal(hr, ctx, { ...draft, employeeId: "E1", fullName: "Шамуратова Гуласал Янгибаевна" }));
check("работал в месяце: принят до конца, уволен после начала", employedIn({ hiredAt: "2024-01-10", firedAt: "2024-05-31" }, "2024-05"), true);
check("не работал: уволен до начала месяца", employedIn({ hiredAt: "2024-01-10", firedAt: "2024-05-31" }, "2024-06"), false);
check("не работал: принят после конца месяца", employedIn({ hiredAt: "2024-07-01", firedAt: "" }, "2024-06"), false);
check("без дат — работал", employedIn({ hiredAt: "", firedAt: "" }, "2024-06"), true);

// --- Ставки ---------------------------------------------------------------------
const e1 = employees[0];
const rateDraft = { employeeId: "E1", from: "2024-07-01", salary1c: 74569, total: 175000, dayRate: 0, nightRate: 0, note: "" };
allows("бухгалтер ставит ставку", rateRefusal(accountant, e1, rateDraft));
refuses("кадровик ставку не ставит", rateRefusal(hr, e1, rateDraft));
refuses("без даты начала", rateRefusal(accountant, e1, { ...rateDraft, from: "" }));
refuses("оклад ноль", rateRefusal(accountant, e1, { ...rateDraft, salary1c: 0 }));
refuses("ИТОГО меньше оклада", rateRefusal(accountant, e1, { ...rateDraft, total: 50000 }));
allows("ИТОГО пустое — только оклад (KPI 0)", rateRefusal(accountant, e1, { ...rateDraft, total: 0 }));
const hourly = emp({ employeeId: "H1", fullName: "Қожабеков Жайнар", payType: "hourly" });
refuses("почасовому нужен тариф, а не оклад", rateRefusal(accountant, hourly, rateDraft));
allows("почасовой с тарифами", rateRefusal(accountant, hourly, { ...rateDraft, salary1c: 0, total: 0, dayRate: 437.5, nightRate: 1093.75 }));
check("KPI = ИТОГО − оклад", kpiOf({ salary1c: 74569, total: 175000 }), 100431);
check("KPI не отрицательный", kpiOf({ salary1c: 74569, total: 0 }), 0);
const rates: Rate[] = [
  { rateId: "R1", employeeId: "E1", from: "2024-01-01", salary1c: 70000, kpi: 80000, total: 150000, dayRate: 0, nightRate: 0, note: "", setBy: "", setAt: "" },
  { rateId: "R2", employeeId: "E1", from: "2024-07-01", salary1c: 74569, kpi: 100431, total: 175000, dayRate: 0, nightRate: 0, note: "", setBy: "", setAt: "" },
  { rateId: "R3", employeeId: "E1", from: "2024-09-15", salary1c: 74569, kpi: 120431, total: 195000, dayRate: 0, nightRate: 0, note: "", setBy: "", setAt: "" },
];
check("ставка на месяц — последняя, начавшаяся не позже 1-го", rateFor(rates, "E1", "2024-08")?.rateId, "R2");
check("ставка с 15-го числа к этому месяцу ещё не применяется", rateFor(rates, "E1", "2024-09")?.rateId, "R2");
check("а к следующему — применяется", rateFor(rates, "E1", "2024-10")?.rateId, "R3");
check("до первой ставки — null", rateFor(rates, "E1", "2023-12"), null);
check("чужого сотрудника — null", rateFor(rates, "E2", "2024-08"), null);

// --- Баланс ---------------------------------------------------------------------
const balanceDraft = { month: "2024-07", days5: 22, hours5: 176, days6: 26, hours6: 176 };
allows("бухгалтер ведёт баланс", balanceRefusal(accountant, balanceDraft));
refuses("кадровик баланс не ведёт", balanceRefusal(hr, balanceDraft));
refuses("месяц не по форме", balanceRefusal(accountant, { ...balanceDraft, month: "07.2024" }));
refuses("норма без часов", balanceRefusal(accountant, { ...balanceDraft, hours5: 0 }));
refuses("норма 300 часов — опечатка", balanceRefusal(accountant, { ...balanceDraft, hours6: 300 }));
const balance = [{ month: "2024-07", days5: 22, hours5: 176, days6: 26, hours6: 174, updatedBy: "", updatedAt: "" }];
check("норма пятидневки — перебивка бухгалтера", normHours(balance, "2024-07", 5), 176);
check("норма шестидневки — перебивка бухгалтера", normHours(balance, "2024-07", 6), 174);
check("нет перебивки — норма по календарю (август 2024)", normHours(balance, "2024-08", 5), 168);
check("дни по календарю", normDays(balance, "2024-08", 6), 26);
check("подсказка по календарю: июль 2024 (6 июля — суббота, перенос на 8-е)", suggestBalance("2024-07"), { month: "2024-07", days5: 22, hours5: 176, days6: 26, hours6: 176 });
check("январь 2024: 7 января — воскресенье, выходной перенесён на 8-е", suggestBalance("2024-01")?.days5, 20);

// --- Календарь РК ------------------------------------------------------------------
// Официальный производственный календарь на 2026 год: пятидневка 246 дней / 1 968 часов, шестидневка — 248 дней по 7 ч
// и 50 суббот по 5 ч (1 986 часов). Помесячно — как публикуют бухгалтерские справочники.
const official2026 = [19, 20, 18, 22, 17, 22, 22, 20, 22, 21, 21, 22];
const y2026 = yearNorm(2026);
check("2026: рабочие дни пятидневки по месяцам", y2026.map((m) => m.days5), official2026);
check("2026: часы пятидневки за год", y2026.reduce((a, m) => a + m.hours5, 0), 1968);
check("2026: дни шестидневки за год", y2026.reduce((a, m) => a + m.days6, 0), 298);
check("2026: часы шестидневки за год", y2026.reduce((a, m) => a + m.hours6, 0), 1986);
check(
  "2026: переносы пятидневки",
  nonWorkingDays(2026, 5).filter((d) => d.kind === "transfer").map((d) => d.date),
  ["2026-03-09", "2026-03-24", "2026-03-25", "2026-05-11", "2026-08-31", "2026-10-26"]
);
check(
  "2026: переносы шестидневки (суббота рабочая — 21 марта и 9 мая не переносятся)",
  nonWorkingDays(2026, 6).filter((d) => d.kind === "transfer").map((d) => d.date),
  ["2026-03-09", "2026-03-24", "2026-08-31", "2026-10-26"]
);
check("2025: пятидневка 246 дней", yearNorm(2025).reduce((a, m) => a + m.days5, 0), 246);
check("Курбан-айт 2026 — праздник", isHoliday("2026-05-27"), true);
check("перенос — выходной, но не праздник (×1,5 не платится)", [isDayOff("2026-03-09", 5), isHoliday("2026-03-09")], [true, false]);
check("обычная суббота при шестидневке — рабочая", isDayOff("2026-03-14", 6), false);
check("суббота-праздник при шестидневке — выходной", isDayOff("2026-03-21", 6) || isHoliday("2026-03-21"), true);
// Дополнения бухгалтера: объявленный выходной, рабочая суббота, Курбан-айт на год без даты в коде.
const extras: ExtraDay[] = [
  { date: "2026-01-05", name: "постановление", kind: "off" },
  { date: "2026-01-10", name: "рабочая суббота", kind: "work" },
];
check("дополнительный выходной уменьшает норму", monthNorm("2026-01", [extras[0]]).days5, 18);
check("рабочая суббота прибавляет день пятидневке", monthNorm("2026-01", extras).days5 - monthNorm("2026-01", [extras[0]]).days5, 1);
check("Курбан-айт за год без даты в коде — из дополнений", lawHolidays(2035, [{ date: "2035-02-11", name: "Курбан-айт", kind: "" }]).some((h) => h.date === "2035-02-11"), true);
// Сверка с isdayoff.ru: строка по дню года; расхождение находится, мусор — null.
const ours2026 = Array.from({ length: 365 }, (_, i) => (isDayOff(addDays("2026-01-01", i), 5) ? "1" : "0")).join("");
check("сверка: совпадающий календарь — без расхождений", compareWithIsDayOff(2026, ours2026), []);
check("сверка: одно расхождение найдено", compareWithIsDayOff(2026, "1" + ours2026.slice(1))?.map((d) => d.date), ["2026-01-01"].filter(() => !isDayOff("2026-01-01", 5)));
check("сверка: мусор — null", compareWithIsDayOff(2026, "100"), null);

// --- Штатная расстановка файлом ------------------------------------------------------
const staffingMatrix: string[][] = [
  ["", "ШТАТНАЯ РАССТАНОВКА СОТРУДНИКОВ ТОО ROSE FARM, Октябрь 2026"],
  ["№", "ФИО работника", "Подразделение", "Должности", "Вид занятости", "ОКЛАД (1С)", "KPI", "ИТОГО", "Комментарии", "Место жительства ", "Стоимость проезда в 2 конца"],
  ["№", "Теплица "],
  ["1", "Мусрепова Айгуль", "Теплица", "Бригадир теплицы", "ТД", "157470", "112530", "270000", "оклад 150 +KPI", "Аксай", "400"],
  ["2", "Косим Балнұр", "Теплица", "Цветовод", "ГПХ", "74 800", "105200", "180 000", "", "Караой", "900"],
  ["", "Звено сортировки - упаковки"],
  ["1", "Чибиряк Олеся", "Администрация теплицы", "Главный бухгалтер", "ТД", "", "", "", "", "Город ", "1000"],
  ["1", "Әбілда Азамат", "Програмное управление", "Операторы «Priva»", "ТД", "74800", "165200", "240000", "", "Аксай", "400"],
  ["2", "Новый Человек", "Отдел маркетинга", "Маркетолог", "ТД", "100000", "0", "100000"],
];
const parsed = parseStaffingMatrix(staffingMatrix);
check("штатка: заголовок и месяц", [parsed.title.includes("Октябрь"), monthFromTitle(parsed.title, "")], [true, "2026-10-01"]);
check("штатка: строки людей (группы и «№» пропущены)", parsed.rows.map((r) => r.fullName), ["Мусрепова Айгуль", "Косим Балнұр", "Чибиряк Олеся", "Әбілда Азамат", "Новый Человек"]);
check("штатка: числа с пробелами читаются", parsed.rows[1].salary1c + parsed.rows[1].total, 74800 + 180000);
check("штатка: ГПХ, дорожные, заметка", [parsed.rows[1].employment, parsed.rows[1].travelRate, parsed.rows[0].note], ["gph", 900, "оклад 150 +KPI"]);
const sctx = { departments: depts, employees: [emp({ employeeId: "e1", fullName: "Мусрепова Айгуль", position: "Бригадир теплицы", travelAddress: "Аксай", travelRate: 400 })], rates: [{ rateId: "r1", employeeId: "e1", from: "2026-07-01", salary1c: 157470, kpi: 0, total: 250000, dayRate: 0, nightRate: 0, note: "", setBy: "", setAt: "" }], from: "2026-10-01", farm: "rose_farm" };
const splan = planStaffingImport(parsed, sctx);
check("штатка: новые подразделения с правилами (приставки у Rose Farm нет)", splan.newDepartments.map((d) => `${d.deptId}:${d.workWeek}`), ["admin:5", "priva:5", "otdel-marketinga:5"]);
check("штатка: незнакомое подразделение названо", splan.unknownDepartments, ["Отдел маркетинга"]);
check("штатка: существующий по ФИО не заводится, у него новая ставка (ИТОГО изменился)", [splan.newEmployees.length, splan.newRates.map((r) => `${r.employee.fullName}:${r.was?.total}->${r.total}`)], [4, ["Мусрепова Айгуль:250000->270000"]]);
check("штатка: операторы PRIVA — почасовые", splan.newEmployees.find((n) => n.row.fullName === "Әбілда Азамат")?.payType, "hourly");
check("штатка: без оклада — в список noRate", splan.noRate, ["Чибиряк Олеся"]);
check("штатка: без ФИО/подразделения — не разобралось", parseStaffingMatrix([["a", "b"]]).rows.length, 0);
check("штатка: у Есентая коды с приставкой", planStaffingImport(parsed, { ...sctx, employees: [], farm: "esentai" }).newDepartments.map((d) => d.deptId).slice(0, 2), ["es-teplitsa", "es-admin"]);

// --- Табель ------------------------------------------------------------------------
{
  check("табель: коды в одном написании", ["бс", "б-с", "Б/С", "п", "B", "o", "8,5", "8", "24", "0", "25", "абв", ""].map((v) => normalizeCell(v)), ["БС", "БС", "БС", "П", "В", "О", "8.5", "8", "24", "", null, null, ""]);
  check("табель: дни одной ячейкой и обратно", decodeDays(encodeDays(["8", "", "Б", "", ""]), 5), ["8", "", "Б", "", ""]);
  check("табель: хвост пустых не пишется", encodeDays(["8", "", "Б", "", ""]), "8||Б");
  // Июль 2024, Сборка ГП (шестидневка), Орынбаева Д. — из старого табеля: 261 ч, праздничных 11, сверхурочных 74.
  const july = dayInfos("2024-07", 6);
  const diana = [8, 11, 10, 12, 16, 11, null, 13, 12, 9, 8, 8, 12, null, 13, 12, 10, 12, 8, 8, null, 13, 11, 9, 8, null, 7, null, 10, 10, null].map((v) => (v === null ? "" : String(v)));
  const ds = summarizeRow(diana, july, { workWeek: 6, overtime: true, dayShiftHours: 7 });
  check("табель: июль 2024 Сборка ГП — часы, праздничные, сверхурочные как в старом табеле", [ds.hours, ds.holidayHours, ds.normHours, ds.overtime], [261, 11, 176, 74]);
  check("табель: 6 июля 2024 — праздник, у шестидневки выходной", [july[5].holiday, july[5].off], [true, true]);
  const fired = applyFired([...diana], 22);
  const fs = summarizeRow(fired, july, { workWeek: 6, overtime: true, dayShiftHours: 7 });
  check("табель: «У» — до конца месяца, норма личная (только дни работы)", [fired.slice(22).every((c) => c === "У"), fs.normHours], [true, 122]);
  const oct = dayInfos("2026-10", 5);
  const filled = fillBySchedule(oct.map(() => ""), oct, 5);
  check("табель: по графику — рабочие дни по 8, выходные пусто; 26.10 (перенос Дня Республики) пусто", [filled.filter(Boolean).length, filled[0], filled[2], filled[25]], [21, "8", "", ""]);
  check("табель: по графику до приёма не ставит", fillBySchedule(oct.map(() => ""), oct, 5, "2026-10-15").filter(Boolean).length, 11);
  const prot = summarizeRow(["Д", "Д", "О", "Б", "К", "П", "БС"], oct.slice(0, 7), { workWeek: 5, overtime: false, dayShiftHours: dayShiftHours(168, 21) });
  check("табель: «Д» = норма дня, коды считаются днями", [prot.hours, prot.workDays, prot.vacation, prot.sick, prot.trip, prot.absent, prot.unpaid, prot.overtime], [16, 2, 1, 1, 1, 1, 1, 0]);
  check("табель: сменщикам (Охрана) сверхурочные не считаются", summarizeRow(oct.map((_, i) => (i % 3 === 0 ? "24" : "")), oct, { workWeek: 5, overtime: false, dayShiftHours: 8 }).overtime, 0);
  check("табель: непонятная отметка — отказ со строкой и днём", cleanRowCells(["8", "x"], 2, "Иванов").error.includes("Иванов, 2 число"), true);

  const headT = payrollScope({ role: "payroll", payrollRole: "head", payrollDepartments: ["teplitsa"] });
  allows("табель: начальник правит черновик своего", timesheetEditRefusal(headT, "teplitsa", ""));
  allows("табель: начальник правит возвращённый", timesheetEditRefusal(headT, "teplitsa", "returned"));
  refuses("табель: начальник не правит отправленный", timesheetEditRefusal(headT, "teplitsa", "submitted"));
  refuses("табель: начальник не правит принятый", timesheetEditRefusal(headT, "teplitsa", "approved"));
  refuses("табель: начальник не правит чужой", timesheetEditRefusal(headT, "assembly", ""));
  allows("табель: бухгалтер правит на проверке", timesheetEditRefusal(accountant, "teplitsa", "submitted"));
  refuses("табель: кадровик только смотрит", timesheetEditRefusal(payrollScope({ role: "payroll", payrollRole: "hr", payrollDepartments: [] }), "teplitsa", ""));
  allows("табель: начальник отправляет", timesheetMoveRefusal(headT, "teplitsa", "", "submit", ""));
  refuses("табель: начальник не принимает", timesheetMoveRefusal(headT, "teplitsa", "submitted", "approve", ""));
  refuses("табель: вернуть без комментария нельзя", timesheetMoveRefusal(accountant, "teplitsa", "submitted", "return", " "));
  allows("табель: бухгалтер возвращает с комментарием", timesheetMoveRefusal(accountant, "teplitsa", "submitted", "return", "у Иванова 7-го отпуск"));
  check("табель: состояния переходов", (["submit", "approve", "return", "reopen"] as const).map(nextStatus), ["submitted", "approved", "returned", ""]);

  const pe = [
    emp({ employeeId: "a", fullName: "Борисова", deptId: "teplitsa" }),
    emp({ employeeId: "b", fullName: "Андреев", deptId: "teplitsa", firedAt: "2026-09-30" }),
    emp({ employeeId: "c", fullName: "Оператор", deptId: "teplitsa", payType: "hourly" }),
    emp({ employeeId: "d", fullName: "Переведён", deptId: "assembly" }),
    emp({ employeeId: "e", fullName: "Новый", deptId: "teplitsa", hiredAt: "2026-11-02" }),
  ];
  check("табель: кто в строках — работавшие в месяце, почасовым две смены, заполненное остаётся", timesheetPeople(pe, "teplitsa", "2026-10", [{ employeeId: "d", deptId: "teplitsa" }]).map((p) => p.key), ["a|", "c|", "c|night", "d|"]);
  check("табель: месяцы", [shiftMonth("2026-01", -1), shiftMonth("2026-12", 1), monthLabel("2026-10")], ["2025-12", "2027-01", "Октябрь 2026"]);
}

// --- Ведомость ---------------------------------------------------------------------
{
  // Июль 2024, лист «Расчётная ведомость» книги бухгалтера — две живые строки копейка в копейку.
  const r = (p: Partial<Rate>): Rate => ({ rateId: "r", employeeId: "x", from: "2024-07-01", salary1c: 0, kpi: 0, total: 0, dayRate: 0, nightRate: 0, note: "", setBy: "", setAt: "", ...p });
  const cells = (arr: (number | string | null)[]) => arr.map((v) => (v === null ? "" : String(v)));
  const july5 = dayInfos("2024-07", 5);
  const july6 = dayInfos("2024-07", 6);
  const teplitsa = depts[0];
  const assembly = depts[1];
  const base = (over: Partial<PayslipInput>): PayslipInput => ({
    employee: emp({ employeeId: "m", fullName: "Мусрепова Айгуль Тобылбаевна", position: "Бригадир теплицы" }),
    department: teplitsa,
    rate: r({ salary1c: 150000, total: 195000 }),
    normHours: 176,
    dayShiftHours: 8,
    days: july5,
    cells: cells([8, 8, null, null, 8, 8, 8, 8, 8, null, null, 8, 8, 8, 8, 8, null, null, 8, 8, 8, 8, 8, 8, 8, 8, 8, null, 8, 8, null]),
    adjustment: { ...EMPTY_ADJUSTMENT },
    flowersFromStock: 6000,
    ...over,
  });
  const m = computePayslip(base({}));
  check(
    "ведомость: Мусрепова, июль 2024 — факт, праздничные, оклада, KPI, цветы со склада, к выплате как в книге",
    [m.factHours, m.holidayHours, m.salaryPay, m.holidayPay, m.overtimePay, m.kpi, m.flowers, m.toPay],
    [184, 8, 143181.82, 10227.27, 0, 41590.91, 6000, 189000],
  );
  const d = computePayslip(
    base({
      employee: emp({ employeeId: "d", fullName: "Орынбаева Диана Кайратовна", deptId: "assembly", position: "Завсклад ГП Алматы" }),
      department: assembly,
      rate: r({ salary1c: 225000, total: 225000 }),
      days: july6,
      cells: cells([8, 11, 10, 12, 16, 11, null, 13, 12, 9, 8, 8, 12, null, 13, 12, 10, 12, 8, 8, null, 13, 11, 9, 8, null, 7, null, 10, 10, null]),
      adjustment: { ...EMPTY_ADJUSTMENT, flowers: 65400 },
      flowersFromStock: 0,
    }),
  );
  check(
    "ведомость: Орынбаева, июль 2024 — сверхурочные ×0,5, KPI не ниже нуля, цветы перебиты бухгалтером",
    [d.factHours, d.holidayHours, d.overtimeHours, d.salaryPay, d.holidayPay, d.overtimePay, d.kpi, d.flowersOverridden, d.toPay],
    [261, 11, 74, 210937.5, 21093.75, 47301.14, 0, true, 213932.39],
  );
  check("ведомость: сверхурочные НЕ уменьшают KPI (бригадир со сверхурочными получил бы столько же KPI)", computePayslip(base({ department: { ...teplitsa, overtime: true, overtimeRate: 1 } })).kpi, 41590.91);
  const sick = computePayslip(base({ adjustment: { ...EMPTY_ADJUSTMENT, sick: 20000, advance: 50000, loan: 10000 }, cells: cells(july5.map((x, i) => (i < 5 ? "Б" : x.off ? null : 8))) }));
  check("ведомость: больничный входит в KPI-базу и в начисление, аванс и займ — удержания", [sick.sickDays, sick.sick, sick.accrued - sick.toPay], [5, 20000, 50000 + 10000 + 6000]);
  const over = computePayslip(base({ adjustment: { ...EMPTY_ADJUSTMENT, salaryOverride: 100000 } }));
  check("ведомость: перебивка «Оклада» берётся как есть и KPI считается от неё", [over.salaryOverridden, over.salaryPay, over.kpi], [true, 100000, 195000 - 100000 - 10227.27]);
  const half = computePayslip(base({ employee: emp({ employeeId: "n", fullName: "Новая", hiredAt: "2024-07-16" }), cells: cells(july5.map((x, i) => (i < 15 || x.off ? null : 8))) }));
  check("ведомость: принят 16-го — норма пропорционально дням графика, без «табель пустой»", [half.personalNorm, half.salaryPay, half.kpi, half.warnings], [96, 81818.18, Math.round((195000 * 96 / 176 - 81818.18) * 100) / 100, []]);
  check("ведомость: доля месяца — весь месяц 1, уволен 15-го — половина рабочих часов", [employmentFraction(july5, 5, "2024-01-01", ""), Math.round(employmentFraction(july5, 5, "", "2024-07-15") * 1000) / 1000], [1, 0.455]);
  const hourlyRow = computePayslip(base({ employee: emp({ employeeId: "h", fullName: "Оператор", payType: "hourly" }), rate: r({ dayRate: 1000, nightRate: 1500 }), cells: cells([12, null, 12]), nightCells: cells([null, 12, null]), days: july5.slice(0, 3), normHours: 24, dayShiftHours: 8, flowersFromStock: 0 }));
  check("ведомость: почасовой — день и ночь по тарифам, KPI нет", [hourlyRow.factHours, hourlyRow.nightHours, hourlyRow.salaryPay, hourlyRow.kpi, hourlyRow.toPay], [36, 12, 42000, 0, 42000]);
  check("ведомость: почасовой без тарифов — предупреждение, не ноль молча", computePayslip(base({ employee: emp({ employeeId: "h", fullName: "Оператор", payType: "hourly" }), rate: null })).warnings.some((w) => w.includes("тариф")), true);
  check("ведомость: без ставки — предупреждение", computePayslip(base({ rate: null })).warnings, ["нет ставки"]);
  check("ведомость: дорожные = ставка × отработанные дни, отдельно от «к выплате»", (() => { const t = computePayslip(base({ employee: emp({ employeeId: "t", fullName: "Т", travelRate: 400 }) })); return [t.travel, t.toPay]; })(), [400 * 23, 189000]);
  const tot = sumRows([m, d]);
  check("ведомость: итоги складываются", [tot.people, tot.toPay, tot.flowers], [2, 189000 + 213932.39, 71400]);
  check("ведомость: аванс 50 % — от ИТОГО, целыми сотнями", [advanceHalf(r({ salary1c: 150000, total: 195000 })), advanceHalf(r({ salary1c: 74569 })), advanceHalf(null)], [97500, 37200, 0]);
  check("ведомость: поля из браузера — числа с запятой, пустая перебивка — «считаем сами», минус не пускаем", cleanAdjustment({ sick: "1 200,5", advance: "-5", salaryOverride: "", flowers: "0", note: "  x " }), { salaryOverride: null, sick: 1200.5, vacation: 0, kpiDeduction: 0, advance: 0, loan: 0, flowers: 0, note: "x" });
  check("ведомость: пустая правка узнаётся", [adjustmentIsEmpty({ ...EMPTY_ADJUSTMENT }), adjustmentIsEmpty({ ...EMPTY_ADJUSTMENT, flowers: 0 })], [true, false]);
  allows("ведомость: бухгалтер правит", adjustmentRefusal(accountant));
  allows("ведомость: админ правит", adjustmentRefusal(admin));
  refuses("ведомость: кадровик только смотрит", adjustmentRefusal(hr));
  refuses("ведомость: начальник не видит денег", adjustmentRefusal(head));
  check("ведомость: вкладка — у тех, кто видит деньги, у начальника нет", [payrollTabsFor(hr).some((t) => t.label === "Ведомость"), payrollTabsFor(head).some((t) => t.label === "Ведомость")], [true, false]);
}

// --- Назначение ролей ------------------------------------------------------------
const actx = { actorEmail: "owner@x", departments: depts };
allows("админ назначает бухгалтера", accessRefusal(admin, actx, { email: "a@x", payrollRole: "accountant", departments: [] }));
allows("админ назначает начальника с подразделением", accessRefusal(admin, actx, { email: "a@x", payrollRole: "head", departments: ["teplitsa"] }));
refuses("начальник без подразделений", accessRefusal(admin, actx, { email: "a@x", payrollRole: "head", departments: [] }));
refuses("начальник с несуществующим подразделением", accessRefusal(admin, actx, { email: "a@x", payrollRole: "head", departments: ["nope"] }));
refuses("роли нет", accessRefusal(admin, actx, { email: "a@x", payrollRole: "boss", departments: [] }));
allows("снять доступ — пустая роль", accessRefusal(admin, actx, { email: "a@x", payrollRole: "", departments: [] }));
refuses("бухгалтер роли не раздаёт", accessRefusal(accountant, actx, { email: "a@x", payrollRole: "hr", departments: [] }));

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
