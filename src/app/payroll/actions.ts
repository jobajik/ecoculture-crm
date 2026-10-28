"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/actionResult";
import { readTable, SHEET_TABS } from "@/lib/sheets";
import { payrollSession } from "@/lib/payroll/session";
import {
  accessRefusal,
  balanceRefusal,
  cleanBalance,
  cleanDepartment,
  cleanEmployee,
  cleanRate,
  departmentRefusal,
  employeeRefusal,
  holidayRefusal,
  rateRefusal,
  extraDays,
} from "@/lib/payroll/rules";
import { compareWithIsDayOff } from "@/lib/payroll/calendarKz";
import { parseStaffingMatrix, planStaffingImport, type StaffingPlan } from "@/lib/payroll/staffingImport";
import { FARM_ORDER } from "@/lib/constants";
import {
  cleanRowCells,
  employedOn,
  encodeDays,
  monthDays,
  nextStatus,
  rowKey,
  timesheetEditRefusal,
  timesheetMoveRefusal,
  timesheetPeople,
  type TimesheetMove,
} from "@/lib/payroll/timesheet";
import { cleanDeptId } from "@/lib/payroll/access";
import { adjustmentRefusal, cleanAdjustment, type Adjustment } from "@/lib/payroll/payslip";
import type { BalanceDraft, DepartmentDraft, EmployeeDraft, RateDraft } from "@/lib/payroll/types";
import {
  addHoliday,
  deleteBalanceMonth,
  addRate,
  createEmployee,
  deleteRate,
  importStaffing,
  listDepartments,
  listTimesheet,
  listTimesheetStatus,
  saveAdjustments,
  saveTimesheet,
  saveTimesheetStatus,
  listHolidays,
  listEmployees,
  listRates,
  removeHoliday,
  saveBalanceMonth,
  saveDepartment,
  updateEmployee,
} from "@/lib/repo/payroll";
import { listUsers, setPayrollAccess } from "@/lib/repo/users";

/**
 * Действия раздела «Зарплата». Все запреты — в `src/lib/payroll/rules.ts` и проверяются здесь, на сервере;
 * форма зовёт те же функции только ради быстрой подсказки (грабли 1.11). Отказ возвращается текстом через
 * `guard()` (грабли 1.13).
 */

function refreshAll() {
  revalidatePath("/payroll");
  revalidatePath("/payroll/employees");
  revalidatePath("/payroll/departments");
  revalidatePath("/payroll/balance");
  revalidatePath("/payroll/access");
}

async function saveDepartmentActionInner(draft: DepartmentDraft) {
  const { scope } = await payrollSession();
  const departments = await listDepartments();
  const refusal = departmentRefusal(scope, departments, draft);
  if (refusal) throw new Error(refusal);
  const clean = cleanDepartment(draft);
  const { created } = await saveDepartment({ ...clean, workWeek: clean.workWeek === 6 ? 6 : 5 });
  refreshAll();
  return { created, deptId: clean.deptId };
}
export async function saveDepartmentAction(draft: DepartmentDraft) {
  return guard(() => saveDepartmentActionInner(draft));
}

async function saveEmployeeActionInner(draft: EmployeeDraft, firstRate: RateDraft | null) {
  const { scope, email } = await payrollSession();
  const [departments, employees] = await Promise.all([listDepartments(), listEmployees()]);
  const refusal = employeeRefusal(scope, { departments, employees }, draft);
  if (refusal) throw new Error(refusal);
  const clean = cleanEmployee(draft);
  const input = {
    fullName: clean.fullName,
    deptId: clean.deptId,
    position: clean.position,
    employment: clean.employment as "td" | "gph",
    payType: clean.payType as "month" | "hourly",
    hiredAt: clean.hiredAt,
    firedAt: clean.firedAt,
    travelAddress: clean.travelAddress,
    travelRate: clean.travelRate,
    iin: clean.iin,
    note: clean.note,
  };
  if (clean.employeeId) {
    const existing = employees.find((e) => e.employeeId === clean.employeeId);
    if (!existing) throw new Error("Сотрудник не найден — возможно, страница открыта из старой версии.");
    await updateEmployee(clean.employeeId, input, email);
    refreshAll();
    revalidatePath(`/payroll/employees/${clean.employeeId}`);
    return { employeeId: clean.employeeId, created: false };
  }
  // Первая ставка вместе с карточкой — только если человеку можно ставки; иначе её поставит бухгалтер.
  let rate: ReturnType<typeof cleanRate> | undefined;
  if (firstRate && (firstRate.salary1c || firstRate.total || firstRate.dayRate)) {
    const rateProblem = rateRefusal(
      scope,
      { ...input, employeeId: "new", createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" },
      { ...firstRate, employeeId: "new", from: firstRate.from || clean.hiredAt }
    );
    if (rateProblem) throw new Error(rateProblem);
    rate = cleanRate({ ...firstRate, employeeId: "new", from: firstRate.from || clean.hiredAt });
  }
  const employeeId = await createEmployee(input, email, rate);
  refreshAll();
  return { employeeId, created: true };
}
export async function saveEmployeeAction(draft: EmployeeDraft, firstRate: RateDraft | null) {
  return guard(() => saveEmployeeActionInner(draft, firstRate));
}

async function addRateActionInner(draft: RateDraft) {
  const { scope, email } = await payrollSession();
  const employees = await listEmployees();
  const employee = employees.find((e) => e.employeeId === draft.employeeId) ?? null;
  const refusal = rateRefusal(scope, employee, draft);
  if (refusal) throw new Error(refusal);
  const clean = cleanRate(draft);
  await addRate(clean.employeeId, clean, email);
  refreshAll();
  revalidatePath(`/payroll/employees/${clean.employeeId}`);
  return { ok: true };
}
export async function addRateAction(draft: RateDraft) {
  return guard(() => addRateActionInner(draft));
}

async function deleteRateActionInner(rateId: string, employeeId: string) {
  const { scope } = await payrollSession();
  if (!scope?.editsRates) throw new Error("Ставки меняет бухгалтер по зарплате или администратор.");
  const rates = await listRates();
  const mine = rates.filter((r) => r.employeeId === employeeId);
  if (mine.length <= 1) throw new Error("Единственную ставку удалить нельзя — поправьте её или добавьте новую с другой даты.");
  const removed = await deleteRate(rateId);
  if (!removed) throw new Error("Ставка не найдена — возможно, её уже удалили.");
  refreshAll();
  revalidatePath(`/payroll/employees/${employeeId}`);
  return { ok: true };
}
export async function deleteRateAction(rateId: string, employeeId: string) {
  return guard(() => deleteRateActionInner(rateId, employeeId));
}

async function saveBalanceActionInner(draft: BalanceDraft) {
  const { scope, email } = await payrollSession();
  const refusal = balanceRefusal(scope, draft);
  if (refusal) throw new Error(refusal);
  const clean = cleanBalance(draft);
  await saveBalanceMonth({ ...clean, updatedBy: email });
  refreshAll();
  return { ok: true };
}
export async function saveBalanceAction(draft: BalanceDraft) {
  return guard(() => saveBalanceActionInner(draft));
}

async function addHolidayActionInner(date: string, name: string, kind: string) {
  const { scope } = await payrollSession();
  const refusal = holidayRefusal(scope, date, kind);
  if (refusal) throw new Error(refusal);
  const created = await addHoliday({ date, name: name.trim(), kind: kind as "" | "off" | "work" });
  refreshAll();
  return { created };
}
export async function addHolidayAction(date: string, name: string, kind: string) {
  return guard(() => addHolidayActionInner(date, name, kind));
}

async function removeBalanceActionInner(month: string) {
  const { scope } = await payrollSession();
  if (!scope?.editsBalance) throw new Error("Норму меняет бухгалтер по зарплате или администратор.");
  const removed = await deleteBalanceMonth(month);
  refreshAll();
  return { removed };
}
export async function removeBalanceAction(month: string) {
  return guard(() => removeBalanceActionInner(month));
}

/**
 * Сверка нашего календаря с внешним (isdayoff.ru, страна kz, пятидневка). Внешний источник может быть
 * недоступен или отставать — тогда так и говорим, тревоги не поднимаем (грабли 1.14).
 */
async function checkCalendarActionInner(year: number) {
  const { scope } = await payrollSession();
  if (!scope) throw new Error("Нет доступа к зарплате.");
  if (!Number.isInteger(year) || year < 2020 || year > 2040) throw new Error("Год вне диапазона.");
  const holidays = await listHolidays();
  let body = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://isdayoff.ru/api/getdata?year=${year}&cc=kz`, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`ответ ${res.status}`);
    body = await res.text();
  } catch (err) {
    return { ok: false as const, message: `isdayoff.ru не ответил (${err instanceof Error ? err.message : "сбой"}) — сверить не с чем, наш календарь остаётся.` };
  }
  const diff = compareWithIsDayOff(year, body, extraDays(holidays));
  if (!diff) return { ok: false as const, message: `isdayoff.ru вернул непонятный ответ (${body.slice(0, 20)}) — возможно, календаря на ${year} год у него ещё нет.` };
  return { ok: true as const, diff };
}
export async function checkCalendarAction(year: number) {
  return guard(() => checkCalendarActionInner(year));
}

async function removeHolidayActionInner(date: string) {
  const { scope } = await payrollSession();
  const refusal = holidayRefusal(scope, date, "");
  if (refusal) throw new Error(refusal);
  const removed = await removeHoliday(date);
  refreshAll();
  return { removed };
}
export async function removeHolidayAction(date: string) {
  return guard(() => removeHolidayActionInner(date));
}

async function setPayrollAccessActionInner(draft: { email: string; payrollRole: string; departments: string[] }) {
  const { scope, email: actorEmail } = await payrollSession();
  const departments = await listDepartments();
  const refusal = accessRefusal(scope, { actorEmail, departments }, draft);
  if (refusal) throw new Error(refusal);
  const users = await listUsers();
  const target = users.find((u) => u.email === draft.email.trim().toLowerCase());
  if (!target) throw new Error("Такого сотрудника нет в CRM — сначала заведите его в «Настройках → Сотрудники».");
  const role = draft.payrollRole.trim().toLowerCase();
  const codes = role === "head" ? draft.departments.map(cleanDeptId).filter(Boolean) : [];
  await setPayrollAccess(target.email, role, codes);
  refreshAll();
  return { ok: true };
}
export async function setPayrollAccessAction(draft: { email: string; payrollRole: string; departments: string[] }) {
  return guard(() => setPayrollAccessActionInner(draft));
}

/**
 * Загрузка штатной расстановки файлом: предпросмотр (`dry = true`) и запись. Строки присылает браузер (файл
 * разобран там — `xlsxLite`), сервер разбирает их заново и сам решает, кого заводить и у кого новая ставка.
 * Может кадровик (сотрудники) и бухгалтер (ставки) — проверяется по тому, что план собирается менять.
 */
async function importStaffingActionInner(matrix: string[][], from: string, farm: string, dry: boolean) {
  const { scope, email } = await payrollSession();
  if (!scope) throw new Error("Нет доступа к зарплате.");
  if (!FARM_ORDER.includes(farm)) throw new Error("Выберите компанию (ТОО).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Укажите, с какого дня действуют ставки из файла (ГГГГ-ММ-ДД).");
  if (!Array.isArray(matrix) || matrix.length > 3000) throw new Error("Файл пустой или слишком большой.");
  const parse = parseStaffingMatrix(matrix.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [])));
  if (!parse.rows.length) throw new Error(parse.skipped[0]?.why ?? "В файле не нашлось ни одной строки с сотрудником.");
  const [departments, employees, rates] = await Promise.all([listDepartments(), listEmployees(), listRates()]);
  const plan: StaffingPlan = planStaffingImport(parse, { departments, employees, rates, from, farm });
  const needsEmployees = plan.newEmployees.length + plan.changedEmployees.length + plan.newDepartments.length > 0;
  const needsRates = plan.newRates.length + plan.newEmployees.filter((n) => n.row.salary1c > 0 || n.row.total > 0).length > 0;
  if (needsEmployees && !scope.editsEmployees) throw new Error("Заводить и менять сотрудников может кадровик или администратор.");
  if (needsRates && !scope.editsRates) throw new Error("Ставки из файла может записать только бухгалтер по зарплате или администратор.");
  if (plan.newDepartments.length && !scope.editsDepartments) throw new Error(`В файле новые подразделения (${plan.newDepartments.map((d) => d.name).join(", ")}) — их заводит администратор.`);
  if (dry) return { title: parse.title, skipped: parse.skipped, plan: summarize(plan) };
  // Перед записью — свежее строгое чтение: сбой Google не должен завести всех второй раз (грабли 1.14).
  await readTable(SHEET_TABS.PAYROLL_EMPLOYEES, { fresh: true });
  const written = await importStaffing(plan, from, email);
  refreshAll();
  return { title: parse.title, skipped: parse.skipped, plan: summarize(plan), written };
}
function summarize(plan: StaffingPlan) {
  return {
    newDepartments: plan.newDepartments.map((d) => d.name),
    unknownDepartments: plan.unknownDepartments,
    newEmployees: plan.newEmployees.map((n) => `${n.row.fullName} — ${n.row.departmentName}, ${n.row.position}`),
    changedEmployees: plan.changedEmployees.map((c) => {
      const what: string[] = [];
      if (c.patch.deptId) what.push(`подразделение → ${c.patch.deptId}`);
      if (c.patch.position) what.push(`должность → ${c.patch.position}`);
      if (c.patch.employment) what.push(`занятость → ${c.patch.employment === "td" ? "ТД" : "ГПХ"}`);
      if (c.patch.travelAddress || c.patch.travelRate !== undefined) what.push("дорожные");
      return `${c.employee.fullName}: ${what.join(", ")}`;
    }),
    newRates: plan.newRates.map((r) => `${r.employee.fullName}: ${r.was ? `${r.was.salary1c} / ${r.was.total}` : "ставки не было"} → ${r.salary1c} / ${r.total}`),
    unchanged: plan.unchanged,
    noRate: plan.noRate,
  };
}
export async function importStaffingAction(matrix: string[][], from: string, farm: string, dry: boolean) {
  return guard(() => importStaffingActionInner(matrix, from, farm, dry));
}

// --- Табель ---------------------------------------------------------------------

async function saveTimesheetActionInner(month: string, deptId: string, input: { employeeId: string; shift: string; cells: string[] }[]) {
  const { scope, email } = await payrollSession();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Непонятный месяц.");
  const dept = (await listDepartments()).find((d) => d.deptId === deptId);
  if (!dept) throw new Error("Такого подразделения нет.");
  const [status] = (await listTimesheetStatus(month)).filter((s) => s.deptId === deptId);
  const refusal = timesheetEditRefusal(scope, deptId, status?.status ?? "");
  if (refusal) throw new Error(refusal);
  const [employees, existing] = await Promise.all([listEmployees(), listTimesheet(month)]);
  const people = new Map(timesheetPeople(employees, deptId, month, existing).map((p) => [p.key, p]));
  const n = monthDays(month).length;
  const days = monthDays(month);
  const rows: { employeeId: string; shift: "" | "night"; days: string }[] = [];
  for (const row of input) {
    const person = people.get(rowKey(row.employeeId, row.shift));
    // Чужого человека или выдуманную смену сервер не пишет (грабли 1.11).
    if (!person) throw new Error("В табеле строка сотрудника не из этого подразделения — обновите страницу.");
    const label = `${person.fullName}${person.shift === "night" ? " (ночь)" : ""}`;
    const cleaned = cleanRowCells(row.cells, n, label);
    if (cleaned.error) throw new Error(cleaned.error);
    // До приёма и после увольнения отметок не бывает — они бы стали часами в расчёте.
    const cells = cleaned.cells.map((c, i) => (employedOn(days[i], person.hiredAt, person.firedAt) || c === "У" ? c : ""));
    rows.push({ employeeId: person.employeeId, shift: person.shift, days: encodeDays(cells) });
  }
  const result = await saveTimesheet(month, deptId, rows, email);
  revalidatePath("/payroll/timesheet");
  return result;
}
export async function saveTimesheetAction(month: string, deptId: string, input: { employeeId: string; shift: string; cells: string[] }[]) {
  return guard(() => saveTimesheetActionInner(month, deptId, input));
}

async function moveTimesheetActionInner(month: string, deptId: string, move: TimesheetMove, comment: string) {
  const { scope, email } = await payrollSession();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Непонятный месяц.");
  const dept = (await listDepartments()).find((d) => d.deptId === deptId);
  if (!dept) throw new Error("Такого подразделения нет.");
  const [current] = (await listTimesheetStatus(month)).filter((s) => s.deptId === deptId);
  const refusal = timesheetMoveRefusal(scope, deptId, current?.status ?? "", move, comment);
  if (refusal) throw new Error(refusal);
  await saveTimesheetStatus({
    month,
    deptId,
    status: nextStatus(move),
    // Комментарий возврата висит над табелем, пока его не отправят снова; при отправке — стирается.
    comment: move === "return" ? comment.trim().slice(0, 500) : move === "submit" ? "" : current?.comment ?? "",
    by: email,
    review: move !== "submit",
  });
  revalidatePath("/payroll/timesheet");
  return { status: nextStatus(move) };
}
export async function moveTimesheetAction(month: string, deptId: string, move: TimesheetMove, comment: string) {
  return guard(() => moveTimesheetActionInner(month, deptId, move, comment));
}

async function saveAdjustmentsActionInner(month: string, input: { employeeId: string; values: Partial<Record<keyof Adjustment, unknown>> }[]) {
  const { scope, email } = await payrollSession();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Непонятный месяц.");
  const refusal = adjustmentRefusal(scope);
  if (refusal) throw new Error(refusal);
  const employees = new Set((await listEmployees()).map((e) => e.employeeId));
  const rows: Adjustment[] = [];
  for (const row of input) {
    // Чужой или выдуманный номер сотрудника сервер не пишет (грабли 1.11).
    if (!employees.has(row.employeeId)) throw new Error("В ведомости строка сотрудника, которого нет в базе — обновите страницу.");
    rows.push({ month, employeeId: row.employeeId, ...cleanAdjustment(row.values) });
  }
  const result = await saveAdjustments(month, rows, email);
  revalidatePath("/payroll/payslip");
  return result;
}
export async function saveAdjustmentsAction(month: string, input: { employeeId: string; values: Partial<Record<keyof Adjustment, unknown>> }[]) {
  return guard(() => saveAdjustmentsActionInner(month, input));
}
