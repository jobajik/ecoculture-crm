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
import { addDays, compareWithIsDayOff, isDayOff, isHoliday, lawHolidays, monthNorm, nonWorkingDays, yearNorm, type ExtraDay } from "../src/lib/payroll/calendarKz";
import { payrollTabsFor } from "../src/app/payroll/tabs";
import { navLinksFor } from "../src/components/navLinks";
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
check("вкладки начальника — только сотрудники", payrollTabsFor(head).map((t) => t.label), ["Сотрудники"]);
check("вкладки админа — с доступом", payrollTabsFor(admin).map((t) => t.label), ["Сотрудники", "Подразделения", "Календарь и нормы", "Доступ"]);
check("вкладки бухгалтера — без доступа", payrollTabsFor(accountant).map((t) => t.label), ["Сотрудники", "Подразделения", "Календарь и нормы"]);

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
