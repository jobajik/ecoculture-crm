/**
 * Кто что может в модуле «Зарплата» — одна чистая таблица на страницы, действия и меню.
 *
 * У человека две роли: роль CRM (Users.Role — пускает ли охранник в раздел вообще) и роль в модуле
 * (Users.PayrollRole). Решения владельца (28.10.2026): админ — всё; бухгалтер по ЗП (Алия) — суммы, ставки, закрытие
 * месяца; кадровик (Лаура) — сотрудники, приём и увольнение, суммы видит; агрономы (Денисы) — всё видят, ничего не
 * правят; начальник подразделения — табель только своих людей, сумм не видит.
 *
 * Ошибка в таблице закрывает доступ, а не открывает (грабли 1.10): роль не из списка или начальник без единого
 * подразделения — доступа нет.
 */

export const PAYROLL_ROLES = {
  ACCOUNTANT: "accountant",
  HR: "hr",
  AGRONOMIST: "agronomist",
  HEAD: "head",
} as const;
export type PayrollRole = (typeof PAYROLL_ROLES)[keyof typeof PAYROLL_ROLES];

export const PAYROLL_ROLE_LABELS: Record<string, string> = {
  accountant: "Бухгалтер по зарплате",
  hr: "Кадровик",
  agronomist: "Агроном",
  head: "Начальник подразделения",
};

export interface PayrollUser {
  /** Роль CRM (Users.Role). */
  role: string | null | undefined;
  payrollRole: string | null | undefined;
  payrollDepartments: string[] | null | undefined;
}

export interface PayrollScope {
  /** admin — по роли CRM, остальное — по роли модуля. */
  kind: "admin" | PayrollRole;
  /** Подразделения начальника; у остальных пусто = все. */
  departments: string[];
  /** Видит ли оклады, KPI и суммы к выплате. */
  seesMoney: boolean;
  /** Сотрудники: завести, поправить, принять и уволить. */
  editsEmployees: boolean;
  /** Ставки (оклад 1С, ИТОГО, тарифы). */
  editsRates: boolean;
  /** Подразделения и их правила. */
  editsDepartments: boolean;
  /** Баланс рабочего времени и праздники. */
  editsBalance: boolean;
  /** Роли в модуле. */
  editsAccess: boolean;
}

const KNOWN: string[] = Object.values(PAYROLL_ROLES);

/** Что человеку можно, или null — раздел закрыт. */
export function payrollScope(user: PayrollUser): PayrollScope | null {
  const role = String(user.role ?? "").trim();
  if (!role) return null;
  if (role === "admin") {
    return {
      kind: "admin",
      departments: [],
      seesMoney: true,
      editsEmployees: true,
      editsRates: true,
      editsDepartments: true,
      editsBalance: true,
      editsAccess: true,
    };
  }
  const payrollRole = String(user.payrollRole ?? "")
    .trim()
    .toLowerCase();
  if (!KNOWN.includes(payrollRole)) return null;
  const departments = (user.payrollDepartments ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const none = {
    departments: [] as string[],
    editsEmployees: false,
    editsRates: false,
    editsDepartments: false,
    editsBalance: false,
    editsAccess: false,
  };
  switch (payrollRole) {
    case PAYROLL_ROLES.ACCOUNTANT:
      return { ...none, kind: "accountant", seesMoney: true, editsRates: true, editsBalance: true };
    case PAYROLL_ROLES.HR:
      return { ...none, kind: "hr", seesMoney: true, editsEmployees: true };
    case PAYROLL_ROLES.AGRONOMIST:
      return { ...none, kind: "agronomist", seesMoney: true };
    case PAYROLL_ROLES.HEAD:
      // Начальник без подразделений — это не «все подразделения», а ошибка в строке Users.
      if (departments.length === 0) return null;
      return { ...none, kind: "head", departments, seesMoney: false };
    default:
      return null;
  }
}

/** Видит ли человек это подразделение. */
export function seesDepartment(scope: PayrollScope, deptId: string): boolean {
  if (scope.departments.length === 0) return true;
  return scope.departments.includes(deptId.trim().toLowerCase());
}

/** Почему человеку закрыт раздел — для страницы, когда охранник его пустил, а роли в модуле нет. */
export const PAYROLL_NO_ACCESS =
  "Раздел «Зарплата» для вашей почты не открыт. Роль в нём назначает администратор на странице Зарплата → Доступ.";

/** Код подразделения для Users и справочника: латиница, цифры, дефис; из «Теплица» делается «teplitsa» руками. */
export function cleanDeptId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
