import { greenhouseSession } from "../greenhouse/session";
import type { GreenhouseScope } from "../greenhouse/access";
import { listDepartments, listEmployees } from "../repo/payroll";
import { prefetchWork } from "../repo/payrollWork";
import { shortName } from "./rules";
import type { Department, Employee } from "./types";
import type { PayrollScope } from "./access";

/**
 * Общее начало страниц выработки: сессия, компания, штат этой компании и справочники одним пакетным чтением
 * (`prefetchWork` берёт и вкладки выработки, и сотрудников с подразделениями — грабли 1.17).
 */
export interface WorkContext {
  /** Права выработки — роль модуля зарплаты (у кого её нет, выработки не видит). */
  scope: PayrollScope | null;
  /** Права раздела «Теплица» — для вкладок и переключателя компании. */
  gh: GreenhouseScope | null;
  email: string;
  farm: string;
  departments: Department[];
  /** Сотрудники подразделений этой компании. */
  employees: Employee[];
  /** Карточка → ФИО, для подстановки имён в сводки. */
  names: Map<string, { fullName: string }>;
}

export async function loadWorkContext(searchParams?: { farm?: string }): Promise<WorkContext> {
  // Выработка живёт в «Теплице» (29.10.2026): компания — теплицы, права — из роли модуля зарплаты.
  const { scope: gh, email, farm } = await greenhouseSession(searchParams);
  const scope = gh?.payroll ?? null;
  if (!scope) return { scope, gh, email, farm, departments: [], employees: [], names: new Map() };
  await prefetchWork();
  const [departments, employees] = await Promise.all([listDepartments(), listEmployees()]);
  const deptIds = new Set(departments.filter((d) => d.farm === farm).map((d) => d.deptId));
  const mine = employees.filter((e) => deptIds.has(e.deptId));
  return { scope, gh, email, farm, departments, employees: mine, names: new Map(mine.map((e) => [e.employeeId, { fullName: e.fullName }])) };
}

/** Сотрудник для списков в браузере — без сумм и лишнего. */
export interface WorkPerson {
  employeeId: string;
  fullName: string;
  short: string;
  deptId: string;
  deptName: string;
  hiredAt: string;
  firedAt: string;
}

export function workPeople(ctx: WorkContext): WorkPerson[] {
  return ctx.employees
    .map((e) => ({
      employeeId: e.employeeId,
      fullName: e.fullName,
      short: shortName(e.fullName),
      deptId: e.deptId,
      deptName: ctx.departments.find((d) => d.deptId === e.deptId)?.name ?? e.deptId,
      hiredAt: e.hiredAt,
      firedAt: e.firedAt,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
}
