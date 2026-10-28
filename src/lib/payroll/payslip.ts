/**
 * Расчётная ведомость — этап 3 (28.10.2026, владелец: «у тебя нет расчётной ведомости общей, как в моей таблице»).
 *
 * Формулы взяты из гугл-книги «Расчётная ведомость ТОО Rose Farm» (лист «Расчётная ведомость», июль 2024) и
 * сверены по строкам в `scripts/check-payroll.ts` («Ведомость»):
 *
 *   Оклада      = Оклад / Норма × (min(Факт, Норма) − Праздничные часы)      — AU
 *   Праздн.     = Оклад / Норма × Праздничные часы × 1,5                    — AX
 *   Сверхур.    = Оклад / Норма × (Факт − Норма − Праздничные) × коэф.      — AY, только подразделениям со
 *                 сверхурочными (Сборка ГП ×0,5, Защита растений ×1)
 *   KPI         = ИТОГО − (Оклада + Больничный + Отпускные + Праздн.) − Удержание с KPI, не меньше нуля — AZ.
 *                 Сверхурочные в KPI НЕ вычитаются: они идут сверх оговорённой суммы — так в книге
 *   К выплате   = Оклада + Больничный + Отпускные + Праздн. + Сверхур. + KPI − Аванс − Займ − Цветы   — BE
 *
 * Норма — норма часов месяца по режиму подразделения (5/6-дневка); у принятого или уволенного в середине месяца
 * норма берётся долей от полной — по графику дней, когда он был в штате (решение владельца: «пропорционально дням»).
 * Почасовым (операторы PRIVA) «Оклада» = часы день × тариф день + часы ночь × тариф ночь; без тарифов — сумму
 * вписывает бухгалтер («Оклада вручную», колонка SalaryOverride). Больничный, отпускные, удержание с KPI, аванс, займ
 * — вписывает бухгалтер (так и в книге). Цветы — считаются из выдач склада (`StaffTakeouts`) по фамилии, бухгалтер
 * может перебить. Дорожные (ставка × отработанные дни) — отдельной колонкой, в «к выплате» не входят: в книге это
 * отдельная ведомость.
 */

import type { Department, Employee, Rate } from "./types";
import type { DayInfo } from "./timesheet";
import { employedOn, scheduleHours } from "./timesheet";

/** Что бухгалтер вписывает руками на сотрудника за месяц. Пустое поле — нуль; SalaryOverride пусто — считаем. */
export interface Adjustment {
  month: string;
  employeeId: string;
  salaryOverride: number | null;
  sick: number;
  vacation: number;
  kpiDeduction: number;
  advance: number;
  loan: number;
  /** null — берём из выдач склада; число — перебивка бухгалтера. */
  flowers: number | null;
  note: string;
}

export const EMPTY_ADJUSTMENT: Omit<Adjustment, "month" | "employeeId"> = {
  salaryOverride: null,
  sick: 0,
  vacation: 0,
  kpiDeduction: 0,
  advance: 0,
  loan: 0,
  flowers: null,
  note: "",
};

export interface PayslipInput {
  employee: Employee;
  department: Department;
  rate: Rate | null;
  /** Норма часов месяца по режиму подразделения (полная). */
  normHours: number;
  /** Часы «Д». */
  dayShiftHours: number;
  days: DayInfo[];
  /** Клетки табеля: обычная смена и ночь (у почасовых). */
  cells: string[];
  nightCells?: string[];
  adjustment: Omit<Adjustment, "month" | "employeeId">;
  /** Выдачи цветка со склада за месяц, ₸ (количество × цена). */
  flowersFromStock: number;
}

export interface PayslipRow {
  employeeId: string;
  fullName: string;
  position: string;
  employment: string;
  deptId: string;
  hourly: boolean;
  salary1c: number;
  total: number;
  /** Факт часов (с ночными у почасовых). */
  factHours: number;
  nightHours: number;
  normHours: number;
  /** Норма с учётом неполного месяца. */
  personalNorm: number;
  holidayHours: number;
  overtimeHours: number;
  workDays: number;
  vacationDays: number;
  sickDays: number;
  tripDays: number;
  absentDays: number;
  unpaidDays: number;
  salaryPay: number;
  salaryOverridden: boolean;
  sick: number;
  vacation: number;
  holidayPay: number;
  overtimePay: number;
  kpi: number;
  kpiDeduction: number;
  accrued: number;
  advance: number;
  loan: number;
  flowers: number;
  flowersFromStock: number;
  flowersOverridden: boolean;
  toPay: number;
  travel: number;
  /** Что мешает посчитать: нет ставки, почасовой без тарифов, табель пустой. */
  warnings: string[];
  note: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function hoursOf(cell: string, dayShift: number): number {
  if (cell === "Д") return dayShift;
  const n = Number(cell);
  return Number.isFinite(n) ? n : 0;
}

/** Доля месяца, когда человек был в штате, — по часам графика (решение владельца: «пропорционально дням»). */
export function employmentFraction(days: DayInfo[], workWeek: 5 | 6, hiredAt: string, firedAt: string): number {
  let all = 0;
  let mine = 0;
  for (const d of days) {
    if (d.off) continue;
    const h = scheduleHours(d.date, workWeek);
    all += h;
    if (employedOn(d.date, hiredAt, firedAt)) mine += h;
  }
  return all > 0 ? mine / all : 1;
}

export function computePayslip(input: PayslipInput): PayslipRow {
  const { employee: e, department: dept, rate, days, cells, adjustment: a } = input;
  const night = input.nightCells ?? [];
  const warnings: string[] = [];
  let fact = 0;
  let nightHours = 0;
  let holidayHours = 0;
  let workDays = 0;
  const counts = { "О": 0, "Б": 0, "К": 0, "П": 0, "БС": 0 } as Record<string, number>;
  days.forEach((d, i) => {
    const c = cells[i] ?? "";
    if (c in counts) counts[c] += 1;
    const h = hoursOf(c, input.dayShiftHours);
    const nh = hoursOf(night[i] ?? "", 0);
    if (h > 0 || nh > 0) workDays += 1;
    fact += h + nh;
    nightHours += nh;
    if (d.holiday) holidayHours += h + nh;
  });
  fact = r2(fact);
  holidayHours = r2(holidayHours);

  const salary1c = rate?.salary1c ?? 0;
  const total = rate?.total ?? 0;
  const fraction = employmentFraction(days, dept.workWeek, e.hiredAt, e.firedAt);
  const personalNorm = r2(input.normHours * fraction);
  const hourly = e.payType === "hourly";

  let salaryPay = 0;
  let holidayPay = 0;
  let overtimePay = 0;
  let overtimeHours = 0;
  // Цена часа — от ПОЛНОЙ нормы месяца: принятый 16-го за свои 96 часов получает 96/176 оклада, а не весь оклад
  // (решение владельца: неполный месяц — пропорционально дням). ИТОГО для KPI урезается той же долей.
  const perHour = input.normHours > 0 ? salary1c / input.normHours : 0;
  const totalForMonth = r2(total * fraction);

  if (a.salaryOverride !== null && a.salaryOverride !== undefined) {
    salaryPay = a.salaryOverride;
  } else if (hourly) {
    const dayRate = rate?.dayRate ?? 0;
    const nightRate = rate?.nightRate ?? 0;
    if (dayRate > 0 || nightRate > 0) salaryPay = (fact - nightHours) * dayRate + nightHours * nightRate;
    else if (fact > 0) warnings.push("почасовой без тарифов — впишите «Оклада» вручную");
  } else {
    if (!rate) warnings.push("нет ставки");
    const paidHours = Math.max(0, Math.min(fact, personalNorm) - holidayHours);
    salaryPay = perHour * paidHours;
  }
  if (!hourly) {
    holidayPay = perHour * holidayHours * 1.5;
    if (dept.overtime) {
      overtimeHours = r2(Math.max(0, fact - personalNorm - holidayHours));
      overtimePay = perHour * overtimeHours * (dept.overtimeRate || 0);
    }
  }
  if (fact === 0 && counts["О"] + counts["Б"] + counts["К"] === 0 && !e.firedAt) warnings.push("табель пустой");

  salaryPay = r2(salaryPay);
  holidayPay = r2(holidayPay);
  overtimePay = r2(overtimePay);
  const sick = a.sick || 0;
  const vacation = a.vacation || 0;
  const kpiDeduction = a.kpiDeduction || 0;
  const kpiBase = totalForMonth - (salaryPay + sick + vacation + holidayPay);
  const kpi = totalForMonth > 0 ? r2(Math.max(0, kpiBase) - kpiDeduction) : 0;
  const accrued = r2(salaryPay + sick + vacation + holidayPay + overtimePay + Math.max(0, kpi));
  const flowers = a.flowers !== null && a.flowers !== undefined ? a.flowers : input.flowersFromStock;
  const toPay = r2(accrued - (a.advance || 0) - (a.loan || 0) - flowers);
  const travel = r2((e.travelRate || 0) * workDays);

  return {
    employeeId: e.employeeId,
    fullName: e.fullName,
    position: e.position,
    employment: e.employment,
    deptId: e.deptId,
    hourly,
    salary1c,
    total,
    factHours: fact,
    nightHours: r2(nightHours),
    normHours: input.normHours,
    personalNorm,
    holidayHours,
    overtimeHours,
    workDays,
    vacationDays: counts["О"],
    sickDays: counts["Б"],
    tripDays: counts["К"],
    absentDays: counts["П"],
    unpaidDays: counts["БС"],
    salaryPay,
    salaryOverridden: a.salaryOverride !== null && a.salaryOverride !== undefined,
    sick,
    vacation,
    holidayPay,
    overtimePay,
    kpi: Math.max(0, kpi),
    kpiDeduction,
    accrued,
    advance: a.advance || 0,
    loan: a.loan || 0,
    flowers: r2(flowers),
    flowersFromStock: r2(input.flowersFromStock),
    flowersOverridden: a.flowers !== null && a.flowers !== undefined,
    toPay,
    travel,
    warnings,
    note: a.note || "",
  };
}

export interface PayslipTotals {
  people: number;
  factHours: number;
  salaryPay: number;
  sick: number;
  vacation: number;
  holidayPay: number;
  overtimePay: number;
  kpi: number;
  accrued: number;
  advance: number;
  loan: number;
  flowers: number;
  toPay: number;
  travel: number;
}

export function sumRows(rows: PayslipRow[]): PayslipTotals {
  const t: PayslipTotals = { people: rows.length, factHours: 0, salaryPay: 0, sick: 0, vacation: 0, holidayPay: 0, overtimePay: 0, kpi: 0, accrued: 0, advance: 0, loan: 0, flowers: 0, toPay: 0, travel: 0 };
  for (const r of rows) {
    t.factHours += r.factHours;
    t.salaryPay += r.salaryPay;
    t.sick += r.sick;
    t.vacation += r.vacation;
    t.holidayPay += r.holidayPay;
    t.overtimePay += r.overtimePay;
    t.kpi += r.kpi;
    t.accrued += r.accrued;
    t.advance += r.advance;
    t.loan += r.loan;
    t.flowers += r.flowers;
    t.toPay += r.toPay;
    t.travel += r.travel;
  }
  (Object.keys(t) as (keyof PayslipTotals)[]).forEach((k) => (t[k] = r2(t[k])));
  return t;
}

/** Аванс 50 % — от оговорённой суммы (ИТОГО); без ИТОГО — от оклада. Целыми сотнями, как платят на руки. */
export function advanceHalf(rate: Rate | null): number {
  const base = rate?.total || rate?.salary1c || 0;
  return Math.floor(base / 2 / 100) * 100;
}

/** Значения бухгалтера из браузера — в числа; пустая строка у перебивок — «не задано». */
export function cleanAdjustment(raw: Partial<Record<keyof Adjustment, unknown>>): Omit<Adjustment, "month" | "employeeId"> {
  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const opt = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : num(v));
  return {
    salaryOverride: opt(raw.salaryOverride),
    sick: Math.max(0, num(raw.sick)),
    vacation: Math.max(0, num(raw.vacation)),
    kpiDeduction: Math.max(0, num(raw.kpiDeduction)),
    advance: Math.max(0, num(raw.advance)),
    loan: Math.max(0, num(raw.loan)),
    flowers: opt(raw.flowers) === null ? null : Math.max(0, opt(raw.flowers) as number),
    note: String(raw.note ?? "").trim().slice(0, 200),
  };
}

export function adjustmentIsEmpty(a: Omit<Adjustment, "month" | "employeeId">): boolean {
  return a.salaryOverride === null && !a.sick && !a.vacation && !a.kpiDeduction && !a.advance && !a.loan && a.flowers === null && !a.note;
}

/** Кто правит ручные поля ведомости: бухгалтер по зарплате и администратор. Остальные — смотрят (или не видят денег). */
export function adjustmentRefusal(scope: { kind: string; seesMoney: boolean } | null): string {
  if (!scope) return "Доступа к зарплате нет.";
  if (!scope.seesMoney) return "Начальник подразделения ведомость не правит — это делает бухгалтер по зарплате.";
  if (scope.kind !== "admin" && scope.kind !== "accountant") return "Ведомость правит бухгалтер по зарплате или администратор.";
  return "";
}
