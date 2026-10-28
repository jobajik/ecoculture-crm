import { SHEET_TABS, prefetchTables } from "../sheets";
import { listStaffTakeouts } from "../repo/staffTakeouts";
import { looseStaffKey, isCompanyUse } from "../staffTakeout";
import { listAdjustments, listBalance, listDepartments, listEmployees, listHolidays, listRates, listTimesheet, listTimesheetStatus, prefetchPayroll } from "../repo/payroll";
import { employedIn, extraDays, normDays, normHours, rateFor } from "./rules";
import { dayInfos, dayShiftHours, decodeDays, rowKey, type DayInfo } from "./timesheet";
import { EMPTY_ADJUSTMENT, computePayslip, sumRows, type Adjustment, type PayslipInput, type PayslipRow, type PayslipTotals } from "./payslip";
import type { Department } from "./types";
import type { TimesheetStatus } from "./timesheet";

/**
 * Сборка ведомости за месяц: читает справочники, табель, ручные поля и выдачи склада и отдаёт то, из чего страница и
 * выгрузка Excel считают строки (`computePayslip`). Расчёт на клиенте идёт по тем же `inputs`, поэтому цифры на экране и
 * в файле одни.
 */

export interface PayslipDept {
  department: Department;
  timesheetStatus: TimesheetStatus;
  inputs: PayslipInput[];
}

export interface PayslipMonth {
  month: string;
  farm: string;
  depts: PayslipDept[];
  /** Фамилии из выдач, которые не нашлись среди сотрудников (или нашлись у двоих). */
  unmatchedFlowers: { name: string; amount: number; why: string }[];
}

export async function loadPayslipMonth(month: string, farm: string, deptFilter?: (d: Department) => boolean): Promise<PayslipMonth> {
  await Promise.all([prefetchPayroll(), prefetchTables([SHEET_TABS.STAFF_TAKEOUTS])]);
  const [departments, employees, rates, balance, holidays, sheet, statuses, adjustments, takeouts] = await Promise.all([
    listDepartments(),
    listEmployees(),
    listRates(),
    listBalance(),
    listHolidays(),
    listTimesheet(month),
    listTimesheetStatus(month),
    listAdjustments(month),
    listStaffTakeouts(),
  ]);
  const extra = extraDays(holidays);
  const adjMap = new Map(adjustments.map((a) => [a.employeeId, a]));

  // Цветы в счёт зарплаты за месяц — по грубому ключу фамилии (как в выдачах: «Ахметова Р.» = «Ахметова Разия …»).
  const flowersByKey = new Map<string, { amount: number; name: string }>();
  for (const t of takeouts) {
    if (isCompanyUse(t) || !t.date.startsWith(month)) continue;
    const key = looseStaffKey(t.staffName);
    if (!key) continue;
    const cur = flowersByKey.get(key) ?? { amount: 0, name: t.staffName };
    cur.amount += (t.quantity || 0) * (t.unitPrice || 0);
    flowersByKey.set(key, cur);
  }
  const employeesByKey = new Map<string, string[]>();
  for (const e of employees) {
    const key = looseStaffKey(e.fullName);
    employeesByKey.set(key, [...(employeesByKey.get(key) ?? []), e.employeeId]);
  }
  const unmatchedFlowers: PayslipMonth["unmatchedFlowers"] = [];
  const flowersByEmployee = new Map<string, number>();
  for (const [key, v] of flowersByKey) {
    const ids = employeesByKey.get(key) ?? [];
    if (ids.length === 1) flowersByEmployee.set(ids[0], Math.round(v.amount * 100) / 100);
    else unmatchedFlowers.push({ name: v.name, amount: Math.round(v.amount), why: ids.length === 0 ? "нет такого сотрудника" : "двое с такой фамилией — впишите цветы вручную" });
  }

  const depts: PayslipDept[] = [];
  for (const d of departments.filter((d) => d.active && (!farm || d.farm === farm) && (!deptFilter || deptFilter(d)))) {
    const days = dayInfos(month, d.workWeek, extra);
    const nh = normHours(balance, month, d.workWeek, holidays);
    const nd = normDays(balance, month, d.workWeek, holidays);
    const dsh = dayShiftHours(nh, nd);
    const people = employees.filter((e) => e.deptId === d.deptId && employedIn(e, month));
    const inputs: PayslipInput[] = people.map((e) => {
      const row = sheet.find((t) => t.employeeId === e.employeeId && t.shift === "");
      const night = sheet.find((t) => t.employeeId === e.employeeId && t.shift === "night");
      const a = adjMap.get(e.employeeId);
      return {
        employee: e,
        department: d,
        rate: rateFor(rates, e.employeeId, month),
        normHours: nh,
        dayShiftHours: dsh,
        days,
        cells: decodeDays(row?.days ?? "", days.length),
        nightCells: night ? decodeDays(night.days, days.length) : undefined,
        adjustment: a ? { ...a } : { ...EMPTY_ADJUSTMENT },
        flowersFromStock: flowersByEmployee.get(e.employeeId) ?? 0,
      };
    });
    depts.push({ department: d, timesheetStatus: statuses.find((s) => s.deptId === d.deptId)?.status ?? "", inputs });
  }
  return { month, farm, depts, unmatchedFlowers };
}

export interface PayslipComputed {
  department: Department;
  timesheetStatus: TimesheetStatus;
  rows: PayslipRow[];
  totals: PayslipTotals;
}

export function computeMonth(data: PayslipMonth): { depts: PayslipComputed[]; totals: PayslipTotals; td: PayslipTotals; gph: PayslipTotals } {
  const depts = data.depts.map((d) => {
    const rows = d.inputs.map(computePayslip).sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
    return { department: d.department, timesheetStatus: d.timesheetStatus, rows, totals: sumRows(rows) };
  });
  const all = depts.flatMap((d) => d.rows);
  return { depts, totals: sumRows(all), td: sumRows(all.filter((r) => r.employment === "td")), gph: sumRows(all.filter((r) => r.employment === "gph")) };
}

export type { DayInfo, Adjustment };
