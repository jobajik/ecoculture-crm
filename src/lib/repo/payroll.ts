import { commitAtomic, deleteWhere, forgetReads, payrollSpreadsheetId, PAYROLL_SHEET_MESSAGE, prefetchTables, readTable, rowToRecord, updateWhere, SHEET_TABS } from "../sheets";
import { ensurePayrollSheet } from "../payrollSheet";
import { sheetNumber } from "../sheetCell";
import { toIsoDate } from "../sheetDate";
import { generateId } from "../id";
import { EMPLOYMENTS, PAY_TYPES, type BalanceMonth, type Department, type Employee, type Holiday, type Rate } from "../payroll/types";
import { kpiOf } from "../payroll/rules";
import type { TimesheetStatus } from "../payroll/timesheet";
import type { Adjustment } from "../payroll/payslip";

/**
 * Справочники модуля «Зарплата» во вкладках Payroll* (чтение — через `rowToRecord` по позиции колонок, числа —
 * через `sheetNumber`, даты — через `toIsoDate`: грабли 1.1, 1.9-bis, 1.9-quater).
 *
 * Чтение завёрнуто в try/catch и отдаёт пустой список, пока вкладки не созданы (`npm run setup-sheet`).
 * Любая запись из нескольких строк — одним `commitAtomic`.
 */

const INACTIVE = new Set(["FALSE", "НЕТ", "NO", "0", "-", "N", "Н"]);
const flag = (v: string) => !INACTIVE.has((v || "").trim().toUpperCase());
const yes = (v: string) => ["TRUE", "ДА", "YES", "1", "Y"].includes((v || "").trim().toUpperCase());

function toDepartment(r: Record<string, string>): Department {
  return {
    deptId: (r.DeptID || "").trim().toLowerCase(),
    name: (r.Name || "").trim(),
    order: sheetNumber(r.Order),
    workWeek: sheetNumber(r.WorkWeek) === 6 ? 6 : 5,
    overtime: yes(r.Overtime),
    overtimeRate: sheetNumber(r.OvertimeRate),
    note: r.Note || "",
    active: flag(r.Active),
    farm: (r.Farm || "").trim().toLowerCase(),
  };
}

function toEmployee(r: Record<string, string>): Employee {
  const employment = (r.Employment || "").trim().toLowerCase();
  const payType = (r.PayType || "").trim().toLowerCase();
  return {
    employeeId: (r.EmployeeID || "").trim(),
    fullName: (r.FullName || "").trim(),
    deptId: (r.DeptID || "").trim().toLowerCase(),
    position: (r.Position || "").trim(),
    employment: employment === EMPLOYMENTS.GPH ? EMPLOYMENTS.GPH : EMPLOYMENTS.TD,
    payType: payType === PAY_TYPES.HOURLY ? PAY_TYPES.HOURLY : PAY_TYPES.MONTH,
    hiredAt: toIsoDate(r.HiredAt),
    firedAt: toIsoDate(r.FiredAt),
    travelAddress: (r.TravelAddress || "").trim(),
    travelRate: sheetNumber(r.TravelRate),
    iin: (r.Iin || "").replace(/\D/g, ""),
    note: r.Note || "",
    createdAt: r.CreatedAt || "",
    createdBy: (r.CreatedBy || "").trim().toLowerCase(),
    updatedAt: r.UpdatedAt || "",
    updatedBy: (r.UpdatedBy || "").trim().toLowerCase(),
  };
}

function toRate(r: Record<string, string>): Rate {
  const salary1c = sheetNumber(r.Salary1C);
  const total = sheetNumber(r.Total);
  return {
    rateId: (r.RateID || "").trim(),
    employeeId: (r.EmployeeID || "").trim(),
    from: toIsoDate(r.From),
    salary1c,
    // KPI в таблице — для чтения глазами; верим ИТОГО и окладу, а не ему.
    kpi: kpiOf({ salary1c, total }),
    total,
    dayRate: sheetNumber(r.DayRate),
    nightRate: sheetNumber(r.NightRate),
    note: r.Note || "",
    setBy: (r.SetBy || "").trim().toLowerCase(),
    setAt: r.SetAt || "",
  };
}

function toBalance(r: Record<string, string>): BalanceMonth {
  // Месяц мог лечь датой (грабли 1.9-bis): «01.07.2024» → 2024-07.
  const raw = (r.Month || "").trim();
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : toIsoDate(raw).slice(0, 7);
  return {
    month,
    days5: sheetNumber(r.Days5),
    hours5: sheetNumber(r.Hours5),
    days6: sheetNumber(r.Days6),
    hours6: sheetNumber(r.Hours6),
    updatedBy: (r.UpdatedBy || "").trim().toLowerCase(),
    updatedAt: r.UpdatedAt || "",
  };
}

function toHoliday(r: Record<string, string>): Holiday {
  const kind = (r.Kind || "").trim().toLowerCase();
  return { date: toIsoDate(r.Date), name: (r.Name || "").trim(), kind: kind === "off" || kind === "work" ? kind : "" };
}

async function rows<T>(tab: string, convert: (r: Record<string, string>) => T, fresh = false): Promise<T[]> {
  try {
    const table = await readTable(tab, { fresh });
    return table.rows.map((row) => convert(rowToRecord(tab, row)));
  } catch {
    return [];
  }
}

export const PAYROLL_TABS = [
  SHEET_TABS.PAYROLL_DEPARTMENTS,
  SHEET_TABS.PAYROLL_EMPLOYEES,
  SHEET_TABS.PAYROLL_RATES,
  SHEET_TABS.PAYROLL_BALANCE,
  SHEET_TABS.PAYROLL_HOLIDAYS,
  SHEET_TABS.PAYROLL_TIMESHEET,
  SHEET_TABS.PAYROLL_TIMESHEET_STATUS,
  SHEET_TABS.PAYROLL_ADJUST,
];

/** Все справочники одним batchGet (грабли 1.17): страница зовёт это первым. */
export async function prefetchPayroll(): Promise<void> {
  await prefetchTables(PAYROLL_TABS);
}

export async function listDepartments(): Promise<Department[]> {
  const list = await rows(SHEET_TABS.PAYROLL_DEPARTMENTS, toDepartment);
  return list.filter((d) => d.deptId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
}

export async function listEmployees(): Promise<Employee[]> {
  const list = await rows(SHEET_TABS.PAYROLL_EMPLOYEES, toEmployee);
  return list.filter((e) => e.employeeId).sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
}

export async function listRates(): Promise<Rate[]> {
  return (await rows(SHEET_TABS.PAYROLL_RATES, toRate)).filter((r) => r.rateId && r.employeeId);
}

export async function listBalance(): Promise<BalanceMonth[]> {
  return (await rows(SHEET_TABS.PAYROLL_BALANCE, toBalance)).filter((b) => /^\d{4}-\d{2}$/.test(b.month)).sort((a, b) => a.month.localeCompare(b.month));
}

export async function listHolidays(): Promise<Holiday[]> {
  return (await rows(SHEET_TABS.PAYROLL_HOLIDAYS, toHoliday)).filter((h) => h.date).sort((a, b) => a.date.localeCompare(b.date));
}

// --- Запись --------------------------------------------------------------------

export async function saveDepartment(dept: Department): Promise<{ created: boolean }> {
  const record = {
    DeptID: dept.deptId,
    Name: dept.name,
    Order: dept.order,
    WorkWeek: dept.workWeek,
    Overtime: dept.overtime ? "TRUE" : "FALSE",
    OvertimeRate: dept.overtime ? dept.overtimeRate : "",
    Note: dept.note,
    Active: dept.active ? "TRUE" : "FALSE",
    Farm: dept.farm,
  };
  // `updateWhere` возвращает true, если строка нашлась (пишет только изменившиеся ячейки); нет — дописываем.
  const found = await updateWhere(SHEET_TABS.PAYROLL_DEPARTMENTS, (r) => (r.DeptID || "").trim().toLowerCase() === dept.deptId, () => record);
  if (found) return { created: false };
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.PAYROLL_DEPARTMENTS, records: [record] }]);
  return { created: true };
}

export async function createEmployee(
  input: Omit<Employee, "employeeId" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">,
  by: string,
  firstRate?: { from: string; salary1c: number; total: number; dayRate: number; nightRate: number; note: string }
): Promise<string> {
  const employeeId = generateId("EMP");
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [
    {
      kind: "append",
      tab: SHEET_TABS.PAYROLL_EMPLOYEES,
      records: [
        {
          EmployeeID: employeeId,
          FullName: input.fullName,
          DeptID: input.deptId,
          Position: input.position,
          Employment: input.employment,
          PayType: input.payType,
          HiredAt: input.hiredAt,
          FiredAt: input.firedAt,
          TravelAddress: input.travelAddress,
          TravelRate: input.travelRate || "",
          Note: input.note,
          CreatedAt: now,
          CreatedBy: by,
          UpdatedAt: now,
          UpdatedBy: by,
          Iin: input.iin,
        },
      ],
    },
  ];
  if (firstRate) ops.push({ kind: "append", tab: SHEET_TABS.PAYROLL_RATES, records: [rateRecord(employeeId, firstRate, by, now)] });
  await commitAtomic(ops);
  return employeeId;
}

export async function updateEmployee(
  employeeId: string,
  input: Omit<Employee, "employeeId" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">,
  by: string
): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.PAYROLL_EMPLOYEES,
    (r) => (r.EmployeeID || "").trim() === employeeId,
    () => ({
      FullName: input.fullName,
      DeptID: input.deptId,
      Position: input.position,
      Employment: input.employment,
      PayType: input.payType,
      HiredAt: input.hiredAt,
      FiredAt: input.firedAt,
      TravelAddress: input.travelAddress,
      TravelRate: input.travelRate || "",
      Note: input.note,
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: by,
      Iin: input.iin,
    })
  );
}

function rateRecord(
  employeeId: string,
  rate: { from: string; salary1c: number; total: number; dayRate: number; nightRate: number; note: string },
  by: string,
  now: string
) {
  return {
    RateID: generateId("RT"),
    EmployeeID: employeeId,
    From: rate.from,
    Salary1C: rate.salary1c,
    Kpi: kpiOf(rate),
    Total: rate.total,
    DayRate: rate.dayRate || "",
    NightRate: rate.nightRate || "",
    Note: rate.note,
    SetBy: by,
    SetAt: now,
  };
}

/** Новая ставка — новой строкой; ставка с той же датой начала у того же сотрудника переписывается. */
export async function addRate(
  employeeId: string,
  rate: { from: string; salary1c: number; total: number; dayRate: number; nightRate: number; note: string },
  by: string
): Promise<void> {
  const now = new Date().toISOString();
  const found = await updateWhere(
    SHEET_TABS.PAYROLL_RATES,
    (r) => (r.EmployeeID || "").trim() === employeeId && toIsoDate(r.From) === rate.from,
    () => ({
      Salary1C: rate.salary1c,
      Kpi: kpiOf(rate),
      Total: rate.total,
      DayRate: rate.dayRate || "",
      NightRate: rate.nightRate || "",
      Note: rate.note,
      SetBy: by,
      SetAt: now,
    })
  );
  if (found) return;
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.PAYROLL_RATES, records: [rateRecord(employeeId, rate, by, now)] }]);
}

export async function deleteRate(rateId: string): Promise<number> {
  return deleteWhere(SHEET_TABS.PAYROLL_RATES, (r) => (r.RateID || "").trim() === rateId);
}

export async function saveBalanceMonth(b: Omit<BalanceMonth, "updatedAt">): Promise<void> {
  const now = new Date().toISOString();
  const record = { Month: b.month, Days5: b.days5, Hours5: b.hours5, Days6: b.days6, Hours6: b.hours6, UpdatedBy: b.updatedBy, UpdatedAt: now };
  const found = await updateWhere(SHEET_TABS.PAYROLL_BALANCE, (r) => toBalance(r).month === b.month, () => record);
  if (found) return;
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.PAYROLL_BALANCE, records: [record] }]);
}

export async function addHoliday(h: Holiday): Promise<boolean> {
  const found = await updateWhere(SHEET_TABS.PAYROLL_HOLIDAYS, (r) => toIsoDate(r.Date) === h.date, () => ({ Name: h.name, Kind: h.kind }));
  if (found) return false;
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.PAYROLL_HOLIDAYS, records: [{ Date: h.date, Name: h.name, Kind: h.kind }] }]);
  return true;
}

/** Снять перебивку нормы месяца — дальше месяц считается по календарю. */
export async function deleteBalanceMonth(month: string): Promise<number> {
  return deleteWhere(SHEET_TABS.PAYROLL_BALANCE, (r) => toBalance(r).month === month);
}

export async function removeHoliday(date: string): Promise<number> {
  return deleteWhere(SHEET_TABS.PAYROLL_HOLIDAYS, (r) => toIsoDate(r.Date) === date);
}

/**
 * Запись плана загрузки штатной расстановки: новые подразделения, новые сотрудники с первой ставкой, правки
 * существующих (только изменившиеся ячейки) и новые строки ставок — одним `commitAtomic` после ОДНОГО свежего
 * чтения вкладки сотрудников (грабли 1.15, 1.16). Ставка в тот же день `from`, что уже есть у человека,
 * переписывается, а не дублируется.
 */
export async function importStaffing(
  plan: import("../payroll/staffingImport").StaffingPlan,
  from: string,
  by: string
): Promise<{ departments: number; employees: number; changed: number; rates: number }> {
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  if (plan.newDepartments.length) {
    ops.push({
      kind: "append",
      tab: SHEET_TABS.PAYROLL_DEPARTMENTS,
      records: plan.newDepartments.map((d) => ({
        DeptID: d.deptId,
        Name: d.name,
        Order: d.order,
        WorkWeek: d.workWeek,
        Overtime: d.overtime ? "TRUE" : "FALSE",
        OvertimeRate: d.overtime ? d.overtimeRate : "",
        Note: "из штатной расстановки",
        Active: "TRUE",
        Farm: d.farm,
      })),
    });
  }
  const empRecords: Record<string, unknown>[] = [];
  const rateRecords: Record<string, unknown>[] = [];
  let firstRates = 0;
  for (const n of plan.newEmployees) {
    const employeeId = generateId("EMP");
    empRecords.push({
      EmployeeID: employeeId,
      FullName: n.row.fullName,
      DeptID: n.deptId,
      Position: n.row.position,
      Employment: n.row.employment,
      PayType: n.payType,
      HiredAt: "",
      FiredAt: "",
      TravelAddress: n.row.travelAddress,
      TravelRate: n.row.travelRate || "",
      Note: n.row.note,
      CreatedAt: now,
      CreatedBy: by,
      UpdatedAt: now,
      UpdatedBy: by,
      Iin: "",
    });
    if (n.payType === "month" && (n.row.salary1c > 0 || n.row.total > 0)) {
      rateRecords.push(rateRecord(employeeId, { from, salary1c: n.row.salary1c, total: n.row.total, dayRate: 0, nightRate: 0, note: "из штатной расстановки" }, by, now));
      firstRates += 1;
    }
  }
  if (plan.changedEmployees.length) {
    const table = await readTable(SHEET_TABS.PAYROLL_EMPLOYEES, { fresh: true });
    for (const c of plan.changedEmployees) {
      const idx = table.rows.findIndex((row) => (rowToRecord(SHEET_TABS.PAYROLL_EMPLOYEES, row).EmployeeID || "").trim() === c.employee.employeeId);
      if (idx < 0) continue;
      const changes: Record<string, unknown> = { UpdatedAt: now, UpdatedBy: by };
      if (c.patch.deptId !== undefined) changes.DeptID = c.patch.deptId;
      if (c.patch.position !== undefined) changes.Position = c.patch.position;
      if (c.patch.employment !== undefined) changes.Employment = c.patch.employment;
      if (c.patch.travelAddress !== undefined) changes.TravelAddress = c.patch.travelAddress;
      if (c.patch.travelRate !== undefined) changes.TravelRate = c.patch.travelRate || "";
      ops.push({ kind: "update", tab: SHEET_TABS.PAYROLL_EMPLOYEES, rowNumber: table.rowNumbers[idx], changes });
    }
  }
  if (plan.newRates.length) {
    const table = await readTable(SHEET_TABS.PAYROLL_RATES, { fresh: true });
    for (const r of plan.newRates) {
      const idx = table.rows.findIndex((row) => {
        const rec = rowToRecord(SHEET_TABS.PAYROLL_RATES, row);
        return (rec.EmployeeID || "").trim() === r.employee.employeeId && toIsoDate(rec.From) === from;
      });
      if (idx >= 0) {
        ops.push({
          kind: "update",
          tab: SHEET_TABS.PAYROLL_RATES,
          rowNumber: table.rowNumbers[idx],
          changes: { Salary1C: r.salary1c, Kpi: kpiOf({ salary1c: r.salary1c, total: r.total }), Total: r.total, Note: "из штатной расстановки", SetBy: by, SetAt: now },
        });
      } else {
        rateRecords.push(rateRecord(r.employee.employeeId, { from, salary1c: r.salary1c, total: r.total, dayRate: 0, nightRate: 0, note: "из штатной расстановки" }, by, now));
      }
    }
  }
  if (empRecords.length) ops.push({ kind: "append", tab: SHEET_TABS.PAYROLL_EMPLOYEES, records: empRecords });
  if (rateRecords.length) ops.push({ kind: "append", tab: SHEET_TABS.PAYROLL_RATES, records: rateRecords });
  if (ops.length) await commitAtomic(ops);
  return { departments: plan.newDepartments.length, employees: empRecords.length, changed: plan.changedEmployees.length, rates: plan.newRates.length + firstRates };
}

// --- Табель ------------------------------------------------------------------------

export interface TimesheetRow {
  month: string;
  employeeId: string;
  /** "" — обычная (дневная) смена, night — ночная у почасовых. */
  shift: "" | "night";
  deptId: string;
  /** Сырое значение ячейки Days; раскладывается по дням `decodeDays`. */
  days: string;
  updatedBy: string;
  updatedAt: string;
}

export interface TimesheetStatusRow {
  month: string;
  deptId: string;
  status: TimesheetStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  comment: string;
}

function monthOf(raw: string): string {
  const v = (raw || "").trim();
  return /^\d{4}-\d{2}$/.test(v) ? v : toIsoDate(v).slice(0, 7);
}

function toTimesheet(r: Record<string, string>): TimesheetRow {
  return {
    month: monthOf(r.Month),
    employeeId: (r.EmployeeID || "").trim(),
    shift: (r.Shift || "").trim().toLowerCase() === "night" ? "night" : "",
    deptId: (r.DeptID || "").trim().toLowerCase(),
    days: String(r.Days ?? ""),
    updatedBy: (r.UpdatedBy || "").trim().toLowerCase(),
    updatedAt: r.UpdatedAt || "",
  };
}

function toTimesheetStatus(r: Record<string, string>): TimesheetStatusRow {
  const st = (r.Status || "").trim().toLowerCase();
  return {
    month: monthOf(r.Month),
    deptId: (r.DeptID || "").trim().toLowerCase(),
    status: st === "submitted" || st === "approved" || st === "returned" ? st : "",
    submittedBy: (r.SubmittedBy || "").trim().toLowerCase(),
    submittedAt: r.SubmittedAt || "",
    reviewedBy: (r.ReviewedBy || "").trim().toLowerCase(),
    reviewedAt: r.ReviewedAt || "",
    comment: r.Comment || "",
  };
}

export async function listTimesheet(month: string): Promise<TimesheetRow[]> {
  return (await rows(SHEET_TABS.PAYROLL_TIMESHEET, toTimesheet)).filter((t) => t.month === month && t.employeeId);
}

export async function listTimesheetStatus(month?: string): Promise<TimesheetStatusRow[]> {
  return (await rows(SHEET_TABS.PAYROLL_TIMESHEET_STATUS, toTimesheetStatus)).filter((s) => s.deptId && (!month || s.month === month));
}

const TAB_MISSING = "Не удалось завести вкладку в таблице зарплаты. Попробуйте ещё раз через минуту; не помогло — администратор открывает /api/payroll/setup.";

/**
 * Свежее чтение вкладки, которой может ещё не быть (табель, ведомость заведены позже справочников). Нет вкладки —
 * заводим её сами (`ensurePayrollSheet`: дописывает недостающие листы и заголовки, ничего не стирая) и читаем снова.
 * Раньше это был ручной шаг «администратор открывает /api/payroll/setup», и 28.10.2026 владелец упёрся в него при
 * первом же сохранении табеля. Без `PAYROLL_SPREADSHEET_ID` заводить негде — отказ с объяснением.
 */
async function freshOrMissing(tab: string) {
  try {
    return await readTable(tab, { fresh: true });
  } catch {
    if (!payrollSpreadsheetId()) throw new Error(PAYROLL_SHEET_MESSAGE);
    try {
      await ensurePayrollSheet();
      forgetReads();
      return await readTable(tab, { fresh: true });
    } catch {
      throw new Error(TAB_MISSING);
    }
  }
}

/**
 * Записать табель подразделения за месяц: строки, где поменялись дни, — правкой одной ячейки Days (и DeptID), новые
 * — дописываются. Всё одним `commitAtomic` после свежего чтения (грабли 1.15, 1.16). Пустая строка, которой в таблице
 * ещё нет, не заводится.
 */
export async function saveTimesheet(
  month: string,
  deptId: string,
  input: { employeeId: string; shift: "" | "night"; days: string }[],
  by: string
): Promise<{ changed: number; added: number }> {
  const tab = SHEET_TABS.PAYROLL_TIMESHEET;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const append: Record<string, unknown>[] = [];
  let changed = 0;
  for (const row of input) {
    const idx = table.rows.findIndex((r) => {
      const t = toTimesheet(rowToRecord(tab, r));
      return t.month === month && t.employeeId === row.employeeId && t.shift === row.shift;
    });
    if (idx >= 0) {
      const t = toTimesheet(rowToRecord(tab, table.rows[idx]));
      if (t.days === row.days && t.deptId === deptId) continue;
      ops.push({ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes: { Days: row.days, DeptID: deptId, UpdatedBy: by, UpdatedAt: now } });
      changed += 1;
    } else if (row.days !== "") {
      append.push({ Month: month, EmployeeID: row.employeeId, Shift: row.shift, DeptID: deptId, Days: row.days, UpdatedBy: by, UpdatedAt: now });
    }
  }
  if (append.length) ops.push({ kind: "append", tab, records: append });
  if (ops.length) await commitAtomic(ops);
  return { changed, added: append.length };
}

export async function saveTimesheetStatus(next: Omit<TimesheetStatusRow, "submittedBy" | "submittedAt" | "reviewedBy" | "reviewedAt"> & { by: string; review: boolean }): Promise<void> {
  const tab = SHEET_TABS.PAYROLL_TIMESHEET_STATUS;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const changes: Record<string, unknown> = { Status: next.status, Comment: next.comment };
  if (next.review) Object.assign(changes, { ReviewedBy: next.by, ReviewedAt: now });
  else Object.assign(changes, { SubmittedBy: next.by, SubmittedAt: now });
  const idx = table.rows.findIndex((r) => {
    const s = toTimesheetStatus(rowToRecord(tab, r));
    return s.month === next.month && s.deptId === next.deptId;
  });
  if (idx >= 0) {
    await commitAtomic([{ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes }]);
    return;
  }
  await commitAtomic([{ kind: "append", tab, records: [{ Month: next.month, DeptID: next.deptId, ...changes }] }]);
}

// --- Ведомость: ручные поля бухгалтера -------------------------------------------------

function optNum(v: string): number | null {
  return (v ?? "").trim() === "" ? null : sheetNumber(v);
}

function toAdjustment(r: Record<string, string>): Adjustment {
  return {
    month: monthOf(r.Month),
    employeeId: (r.EmployeeID || "").trim(),
    salaryOverride: optNum(r.SalaryOverride),
    sick: sheetNumber(r.Sick),
    vacation: sheetNumber(r.Vacation),
    kpiDeduction: sheetNumber(r.KpiDeduction),
    advance: sheetNumber(r.Advance),
    loan: sheetNumber(r.Loan),
    flowers: optNum(r.Flowers),
    note: r.Note || "",
  };
}

export async function listAdjustments(month: string): Promise<Adjustment[]> {
  return (await rows(SHEET_TABS.PAYROLL_ADJUST, toAdjustment)).filter((a) => a.month === month && a.employeeId);
}

/** Записать ручные поля ведомости: изменившиеся строки — правкой ячеек, новые — дописыванием; одним `commitAtomic`. */
export async function saveAdjustments(month: string, input: Adjustment[], by: string): Promise<{ changed: number; added: number }> {
  const tab = SHEET_TABS.PAYROLL_ADJUST;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const append: Record<string, unknown>[] = [];
  let changed = 0;
  const record = (a: Adjustment) => ({
    SalaryOverride: a.salaryOverride === null ? "" : a.salaryOverride,
    Sick: a.sick || "",
    Vacation: a.vacation || "",
    KpiDeduction: a.kpiDeduction || "",
    Advance: a.advance || "",
    Loan: a.loan || "",
    Flowers: a.flowers === null ? "" : a.flowers,
    Note: a.note,
  });
  for (const a of input) {
    const idx = table.rows.findIndex((r) => {
      const t = toAdjustment(rowToRecord(tab, r));
      return t.month === month && t.employeeId === a.employeeId;
    });
    if (idx >= 0) {
      const was = toAdjustment(rowToRecord(tab, table.rows[idx]));
      if (JSON.stringify({ ...was, month: "", employeeId: "" }) === JSON.stringify({ ...a, month: "", employeeId: "" })) continue;
      ops.push({ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes: { ...record(a), UpdatedBy: by, UpdatedAt: now } });
      changed += 1;
    } else {
      append.push({ Month: month, EmployeeID: a.employeeId, ...record(a), UpdatedBy: by, UpdatedAt: now });
    }
  }
  if (append.length) ops.push({ kind: "append", tab, records: append });
  if (ops.length) await commitAtomic(ops);
  return { changed, added: append.length };
}
