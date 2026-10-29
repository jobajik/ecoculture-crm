"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/actionResult";
import { FARM_ORDER } from "@/lib/constants";
import { payrollSession } from "@/lib/payroll/session";
import { cleanBudgetAmount, isWorkArea, plausibleDate, workBudgetRefusal, workEditRefusal, workType, type ImportRow } from "@/lib/payroll/work";
import { listDepartments, listEmployees, prefetchPayroll } from "@/lib/repo/payroll";
import { deleteWorkEntry, importWorkRows, listWorkIds, saveNameLink, saveWorkBudgets } from "@/lib/repo/payrollWork";
import { localDayKey } from "@/lib/timezone";
import { isMonth } from "@/lib/payroll/rules";

/**
 * Действия выработки. Правила — в `src/lib/payroll/work.ts`, проверяются здесь, на сервере (грабли 1.11); отказ
 * возвращается текстом через `guard()` (грабли 1.13). Страницы после записи перечитываются.
 */

function refresh() {
  revalidatePath("/greenhouse", "layout");
}

function cleanFarm(farm: string): string {
  const f = String(farm ?? "").trim().toLowerCase();
  if (!FARM_ORDER.includes(f)) throw new Error("Не указана компания.");
  return f;
}

/** Штат компании — сотрудники подразделений этой компании (карточка без подразделения в выработку не попадает). */
async function farmEmployees(farm: string) {
  await prefetchPayroll();
  const [departments, employees] = await Promise.all([listDepartments(), listEmployees()]);
  const deptIds = new Set(departments.filter((d) => d.farm === farm).map((d) => d.deptId));
  return employees.filter((e) => deptIds.has(e.deptId));
}

async function deleteWorkEntryActionInner(farm: string, workId: string) {
  const { scope } = await payrollSession();
  const refusal = workEditRefusal(scope);
  if (refusal) throw new Error(refusal);
  const removed = await deleteWorkEntry(cleanFarm(farm), String(workId ?? "").trim());
  if (!removed) throw new Error("Запись не найдена — возможно, её уже удалили.");
  refresh();
  return { ok: true };
}
export async function deleteWorkEntryAction(farm: string, workId: string) {
  return guard(() => deleteWorkEntryActionInner(farm, workId));
}

async function listWorkIdsActionInner(farm: string) {
  const { scope } = await payrollSession();
  const refusal = workEditRefusal(scope);
  if (refusal) throw new Error(refusal);
  return await listWorkIds(cleanFarm(farm));
}
/** Номера уже загруженных строк — чтобы браузер показал, сколько в файле нового, и слал только его. */
export async function listWorkIdsAction(farm: string) {
  return guard(() => listWorkIdsActionInner(farm));
}

const CHUNK_MAX = 4000;

async function importWorkRowsActionInner(farm: string, rows: ImportRow[]) {
  const { scope, email } = await payrollSession();
  const refusal = workEditRefusal(scope);
  if (refusal) throw new Error(refusal);
  const f = cleanFarm(farm);
  if (!Array.isArray(rows) || rows.length === 0) return { added: 0, skipped: 0 };
  if (rows.length > CHUNK_MAX) throw new Error(`За раз загружается не больше ${CHUNK_MAX} строк.`);
  const today = localDayKey();
  // Присланное из браузера проверяется заново (грабли 1.11): участок, вид, дата, числа.
  const clean: ImportRow[] = [];
  for (const r of rows) {
    const area = String(r.area ?? "");
    if (!isWorkArea(area)) throw new Error("В файле строка с неизвестным участком.");
    const type = workType(area, String(r.workType ?? ""));
    if (!type) throw new Error(`Неизвестный вид работ «${r.workType}».`);
    const date = String(r.date ?? "");
    if (!plausibleDate(date, today)) throw new Error(`Непонятная дата «${date}».`);
    const name = String(r.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Строка без ФИО.");
    const qty = Number(r.qty) || 0;
    const hours = Number(r.hours) || 0;
    if (qty < 0 || hours < 0 || hours > 24) throw new Error("Количество и часы должны быть числами (часы — до 24).");
    clean.push({ area, date, name, block: String(r.block ?? "").trim(), part: String(r.part ?? "").trim(), workType: type.code, qty, hours, ordinal: Math.max(1, Math.round(Number(r.ordinal) || 1)) });
  }
  const employees = await farmEmployees(f);
  const result = await importWorkRows(f, clean, employees, email);
  refresh();
  return result;
}
export async function importWorkRowsAction(farm: string, rows: ImportRow[]) {
  return guard(() => importWorkRowsActionInner(farm, rows));
}

async function saveWorkBudgetsActionInner(farm: string, month: string, area: string, input: { workType: string; amount: unknown; note: string }[]) {
  const { scope, email } = await payrollSession();
  const refusal = workBudgetRefusal(scope);
  if (refusal) throw new Error(refusal);
  const f = cleanFarm(farm);
  if (!isMonth(month)) throw new Error("Месяц записан неверно.");
  if (!isWorkArea(area)) throw new Error("Неизвестный участок.");
  const clean: { workType: string; amount: number; note: string }[] = [];
  for (const b of input) {
    const type = workType(area, String(b.workType ?? ""));
    if (!type) throw new Error(`Неизвестный вид работ «${b.workType}».`);
    const amount = cleanBudgetAmount(b.amount);
    if (amount === null) throw new Error(`Бюджет «${type.label}» — число не меньше нуля.`);
    clean.push({ workType: type.code, amount, note: String(b.note ?? "").trim().slice(0, 200) });
  }
  const result = await saveWorkBudgets(f, month, area, clean, email);
  refresh();
  return result;
}
export async function saveWorkBudgetsAction(farm: string, month: string, area: string, input: { workType: string; amount: unknown; note: string }[]) {
  return guard(() => saveWorkBudgetsActionInner(farm, month, area, input));
}

async function linkWorkNameActionInner(farm: string, name: string, employeeId: string) {
  const { scope, email } = await payrollSession();
  const refusal = workEditRefusal(scope);
  if (refusal) throw new Error(refusal);
  const f = cleanFarm(farm);
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n) throw new Error("Пустое имя.");
  const id = String(employeeId ?? "").trim();
  if (id) {
    const employees = await farmEmployees(f);
    if (!employees.some((e) => e.employeeId === id)) throw new Error("Сотрудник не из штата этой компании.");
  }
  await saveNameLink(f, n, id, email);
  refresh();
  return { ok: true };
}
/** Привязать имя из старой книги к карточке сотрудника; пустой employeeId снимает привязку. */
export async function linkWorkNameAction(farm: string, name: string, employeeId: string) {
  return guard(() => linkWorkNameActionInner(farm, name, employeeId));
}
