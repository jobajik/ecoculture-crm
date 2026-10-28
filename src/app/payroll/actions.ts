"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/actionResult";
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
} from "@/lib/payroll/rules";
import { cleanDeptId } from "@/lib/payroll/access";
import type { BalanceDraft, DepartmentDraft, EmployeeDraft, RateDraft } from "@/lib/payroll/types";
import {
  addHoliday,
  addRate,
  createEmployee,
  deleteRate,
  listDepartments,
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

async function addHolidayActionInner(date: string, name: string) {
  const { scope } = await payrollSession();
  const refusal = holidayRefusal(scope, date);
  if (refusal) throw new Error(refusal);
  const created = await addHoliday({ date, name: name.trim() });
  refreshAll();
  return { created };
}
export async function addHolidayAction(date: string, name: string) {
  return guard(() => addHolidayActionInner(date, name));
}

async function removeHolidayActionInner(date: string) {
  const { scope } = await payrollSession();
  const refusal = holidayRefusal(scope, date);
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
