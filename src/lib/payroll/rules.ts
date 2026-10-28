/**
 * Правила справочников «Зарплаты» — чистые функции, покрытые `scripts/check-payroll.ts`.
 *
 * Каждая `…Refusal` возвращает ТЕКСТ, почему сохранить нельзя, или пустую строку. Тот же текст показывает форма
 * (ради скорости) и возвращает сервер (он и запрещает — грабли 1.11, 1.13). Отказ — за попытку изменить, а не за
 * наличие поля.
 */
import { cleanDeptId, type PayrollScope } from "./access";
import {
  EMPLOYMENTS,
  PAY_TYPES,
  type BalanceDraft,
  type BalanceMonth,
  type Department,
  type DepartmentDraft,
  type Employee,
  type EmployeeDraft,
  type Rate,
  type RateDraft,
} from "./types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isMonth(value: string): boolean {
  return MONTH.test(value) && Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12;
}

/** Одно имя — одна запись: регистр, лишние пробелы и «ё» не делают человека другим. */
export function nameKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Подразделения -----------------------------------------------------------

export function cleanDepartment(draft: DepartmentDraft): DepartmentDraft {
  const workWeek = Number(draft.workWeek) === 6 ? 6 : 5;
  const overtime = Boolean(draft.overtime);
  return {
    deptId: cleanDeptId(draft.deptId),
    name: String(draft.name ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    order: Math.max(0, Math.round(Number(draft.order) || 0)),
    workWeek,
    overtime,
    overtimeRate: overtime ? Number(draft.overtimeRate) || 0 : 0,
    note: String(draft.note ?? "").trim(),
    active: draft.active !== false,
  };
}

export function departmentRefusal(scope: PayrollScope | null, existing: Department[], draft: DepartmentDraft): string {
  if (!scope?.editsDepartments) return "Подразделения заводит и меняет только администратор.";
  const clean = cleanDepartment(draft);
  if (!clean.deptId) return "Нужен код подразделения латиницей (например, teplitsa): он ложится в карточки сотрудников.";
  if (!clean.name) return "Не указано название подразделения.";
  const sameName = existing.find((d) => d.deptId !== clean.deptId && nameKey(d.name) === nameKey(clean.name));
  if (sameName) return `Подразделение «${sameName.name}» уже есть (код ${sameName.deptId}).`;
  if (clean.overtime && !(clean.overtimeRate > 0)) {
    return "Включены сверхурочные — укажите коэффициент (1 — по часовой ставке, 0,5 — половина).";
  }
  return "";
}

// --- Сотрудники --------------------------------------------------------------

export function cleanEmployee(draft: EmployeeDraft): EmployeeDraft {
  const employment = String(draft.employment ?? "").trim().toLowerCase();
  const payType = String(draft.payType ?? "").trim().toLowerCase();
  return {
    employeeId: String(draft.employeeId ?? "").trim(),
    fullName: String(draft.fullName ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    deptId: cleanDeptId(draft.deptId),
    position: String(draft.position ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    employment,
    payType: payType || PAY_TYPES.MONTH,
    hiredAt: String(draft.hiredAt ?? "").trim(),
    firedAt: String(draft.firedAt ?? "").trim(),
    travelAddress: String(draft.travelAddress ?? "").trim(),
    travelRate: Math.max(0, Number(draft.travelRate) || 0),
    note: String(draft.note ?? "").trim(),
  };
}

export function employeeRefusal(
  scope: PayrollScope | null,
  ctx: { departments: Department[]; employees: Employee[] },
  draft: EmployeeDraft
): string {
  if (!scope?.editsEmployees) return "Сотрудников заводит и меняет кадровик или администратор.";
  const clean = cleanEmployee(draft);
  if (!clean.fullName) return "Не указано ФИО сотрудника.";
  if (!clean.deptId) return "Не выбрано подразделение.";
  const dept = ctx.departments.find((d) => d.deptId === clean.deptId);
  if (!dept) return `Подразделения с кодом «${clean.deptId}» нет.`;
  if (!clean.position) return "Не указана должность — она идёт в ведомость и приказы.";
  if (![EMPLOYMENTS.TD, EMPLOYMENTS.GPH].includes(clean.employment as "td" | "gph")) {
    return "Вид занятости — ТД или ГПХ.";
  }
  if (![PAY_TYPES.MONTH, PAY_TYPES.HOURLY].includes(clean.payType as "month" | "hourly")) {
    return "Тип расчёта — оклад за месяц или почасовой.";
  }
  if (clean.hiredAt && !isDay(clean.hiredAt)) return "Дата приёма — в виде ГГГГ-ММ-ДД.";
  if (clean.firedAt && !isDay(clean.firedAt)) return "Дата увольнения — в виде ГГГГ-ММ-ДД.";
  if (clean.hiredAt && clean.firedAt && clean.firedAt < clean.hiredAt) return "Дата увольнения раньше даты приёма.";
  if (clean.travelRate > 0 && !clean.travelAddress) return "Указана ставка дорожных — укажите и адрес.";
  // Двойник — предупреждаем запретом только при полном совпадении ФИО у работающего: однофамильцы с разными
  // отчествами бывают, а второй «Иванов Иван Иванович» в штате — почти наверняка ошибка.
  const twin = ctx.employees.find(
    (e) => e.employeeId !== clean.employeeId && !e.firedAt && nameKey(e.fullName) === nameKey(clean.fullName)
  );
  if (twin && !clean.firedAt) {
    return `Сотрудник «${twin.fullName}» уже есть в подразделении «${ctx.departments.find((d) => d.deptId === twin.deptId)?.name ?? twin.deptId}». Если это другой человек — добавьте в ФИО отличие.`;
  }
  return "";
}

/** Работал ли сотрудник в месяце ГГГГ-ММ (хотя бы день): принят не позже конца месяца, уволен не раньше начала. */
export function employedIn(employee: Pick<Employee, "hiredAt" | "firedAt">, month: string): boolean {
  const first = `${month}-01`;
  const last = `${month}-31`;
  if (employee.hiredAt && employee.hiredAt > last) return false;
  if (employee.firedAt && employee.firedAt < first) return false;
  return true;
}

export function isWorking(employee: Pick<Employee, "firedAt">, today: string): boolean {
  return !employee.firedAt || employee.firedAt >= today;
}

// --- Ставки ------------------------------------------------------------------

export function cleanRate(draft: RateDraft): RateDraft {
  const salary1c = Math.max(0, Math.round(Number(draft.salary1c) || 0));
  const total = Math.max(0, Math.round(Number(draft.total) || 0));
  return {
    employeeId: String(draft.employeeId ?? "").trim(),
    from: String(draft.from ?? "").trim(),
    salary1c,
    total,
    dayRate: Math.max(0, Number(draft.dayRate) || 0),
    nightRate: Math.max(0, Number(draft.nightRate) || 0),
    note: String(draft.note ?? "").trim(),
  };
}

export function rateRefusal(scope: PayrollScope | null, employee: Employee | null, draft: RateDraft): string {
  if (!scope?.editsRates) return "Ставки меняет бухгалтер по зарплате или администратор.";
  if (!employee) return "Сотрудник не найден.";
  const clean = cleanRate(draft);
  if (!isDay(clean.from)) return "С какого дня действует ставка — в виде ГГГГ-ММ-ДД.";
  if (employee.payType === PAY_TYPES.HOURLY) {
    if (!(clean.dayRate > 0)) return "У почасового сотрудника нужен тариф в час за день.";
    if (!(clean.nightRate > 0)) return "У почасового сотрудника нужен тариф в час за ночь.";
  } else if (!(clean.salary1c > 0)) {
    return "Оклад (1С) должен быть больше нуля.";
  }
  if (clean.total > 0 && clean.total < clean.salary1c) {
    return "ИТОГО меньше оклада (1С): так KPI вышел бы отрицательным. Проверьте суммы.";
  }
  return "";
}

/** KPI — то, что хранится рядом с ИТОГО для чтения глазами: ИТОГО − оклад 1С, не меньше нуля. */
export function kpiOf(rate: Pick<Rate, "salary1c" | "total">): number {
  return Math.max(0, Math.round(rate.total - rate.salary1c));
}

/** Ставка, действующая в месяце: последняя по дате начала, начавшаяся не позже первого числа; нет — null. */
export function rateFor(rates: Rate[], employeeId: string, month: string): Rate | null {
  const first = `${month}-01`;
  const mine = rates.filter((r) => r.employeeId === employeeId && r.from <= first).sort((a, b) => a.from.localeCompare(b.from));
  return mine.length ? mine[mine.length - 1] : null;
}

/** Ставка на сегодня — для списка сотрудников. */
export function currentRate(rates: Rate[], employeeId: string, today: string): Rate | null {
  const mine = rates.filter((r) => r.employeeId === employeeId && r.from <= today).sort((a, b) => a.from.localeCompare(b.from));
  return mine.length ? mine[mine.length - 1] : null;
}

// --- Баланс рабочего времени -------------------------------------------------

export function cleanBalance(draft: BalanceDraft): BalanceDraft {
  const n = (v: unknown) => Math.max(0, Number(v) || 0);
  return {
    month: String(draft.month ?? "").trim(),
    days5: Math.round(n(draft.days5)),
    hours5: n(draft.hours5),
    days6: Math.round(n(draft.days6)),
    hours6: n(draft.hours6),
  };
}

export function balanceRefusal(scope: PayrollScope | null, draft: BalanceDraft): string {
  if (!scope?.editsBalance) return "Баланс рабочего времени ведёт бухгалтер по зарплате или администратор.";
  const clean = cleanBalance(draft);
  if (!isMonth(clean.month)) return "Месяц — в виде ГГГГ-ММ.";
  if (!(clean.hours5 > 0) || !(clean.days5 > 0)) return "Норма пятидневки: дни и часы должны быть больше нуля.";
  if (!(clean.hours6 > 0) || !(clean.days6 > 0)) return "Норма шестидневки: дни и часы должны быть больше нуля.";
  if (clean.hours5 > 250 || clean.hours6 > 250) return "Норма больше 250 часов в месяц — похоже на опечатку.";
  return "";
}

export function holidayRefusal(scope: PayrollScope | null, date: string): string {
  if (!scope?.editsBalance) return "Праздники ведёт бухгалтер по зарплате или администратор.";
  if (!isDay(date)) return "Дата праздника — в виде ГГГГ-ММ-ДД.";
  return "";
}

/** Норма часов месяца для подразделения: 5- или 6-дневка; нет баланса — null (считать нельзя). */
export function normHours(balance: BalanceMonth[], month: string, workWeek: 5 | 6): number | null {
  const row = balance.find((b) => b.month === month);
  if (!row) return null;
  return workWeek === 6 ? row.hours6 : row.hours5;
}

/**
 * Подсказка для баланса: рабочие дни месяца по календарю минус праздники (пятидневка — пн–пт, шестидневка — пн–сб),
 * часы — 8 в день для пятидневки, по 40-часовой неделе для шестидневки (пн–пт по 7, сб 5). В Казахстане бывают
 * переносы выходных, поэтому это ПОДСКАЗКА, а норму подтверждает бухгалтер.
 */
export function suggestBalance(month: string, holidays: string[]): BalanceDraft | null {
  if (!isMonth(month)) return null;
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const set = new Set(holidays);
  let days5 = 0;
  let days6 = 0;
  let hours6 = 0;
  const daysIn = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(Date.UTC(year, mon - 1, d));
    const iso = date.toISOString().slice(0, 10);
    const dow = date.getUTCDay(); // 0 вс … 6 сб
    if (set.has(iso)) continue;
    if (dow >= 1 && dow <= 5) {
      days5 += 1;
      days6 += 1;
      hours6 += 7;
    } else if (dow === 6) {
      days6 += 1;
      hours6 += 5;
    }
  }
  return { month, days5, hours5: days5 * 8, days6, hours6 };
}

// --- Доступ ------------------------------------------------------------------

export function accessRefusal(
  scope: PayrollScope | null,
  ctx: { actorEmail: string; departments: Department[] },
  draft: { email: string; payrollRole: string; departments: string[] }
): string {
  if (!scope?.editsAccess) return "Роли в «Зарплате» назначает только администратор.";
  const email = draft.email.trim().toLowerCase();
  if (!email) return "Не указана почта сотрудника.";
  const role = draft.payrollRole.trim().toLowerCase();
  if (role && !["accountant", "hr", "agronomist", "head"].includes(role)) return `Роли «${role}» в модуле нет.`;
  const codes = draft.departments.map(cleanDeptId).filter(Boolean);
  if (role === "head") {
    if (codes.length === 0) return "Начальнику нужно хотя бы одно подразделение — иначе он ничего не увидит.";
    const unknown = codes.find((c) => !ctx.departments.some((d) => d.deptId === c));
    if (unknown) return `Подразделения «${unknown}» нет.`;
  }
  return "";
}
