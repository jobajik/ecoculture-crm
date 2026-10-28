import { commitAtomic, deleteWhere, prefetchTables, readTable, rowToRecord, updateWhere, SHEET_TABS } from "../sheets";
import { sheetNumber } from "../sheetCell";
import { toIsoDate } from "../sheetDate";
import { generateId } from "../id";
import { EMPLOYMENTS, PAY_TYPES, type BalanceMonth, type Department, type Employee, type Holiday, type Rate } from "../payroll/types";
import { kpiOf } from "../payroll/rules";

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
  return { date: toIsoDate(r.Date), name: (r.Name || "").trim() };
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
  const found = await updateWhere(SHEET_TABS.PAYROLL_HOLIDAYS, (r) => toIsoDate(r.Date) === h.date, () => ({ Name: h.name }));
  if (found) return false;
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.PAYROLL_HOLIDAYS, records: [{ Date: h.date, Name: h.name }] }]);
  return true;
}

export async function removeHoliday(date: string): Promise<number> {
  return deleteWhere(SHEET_TABS.PAYROLL_HOLIDAYS, (r) => toIsoDate(r.Date) === date);
}
