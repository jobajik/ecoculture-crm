/**
 * Модуль «Зарплата» — типы справочников (28.10.2026).
 *
 * Справочники постоянные: подразделение, сотрудник, ставка с датой начала, баланс рабочего времени, праздники.
 * Помесячное (табель, расчёт) появится следующими этапами и будет ссылаться на эти записи по кодам.
 */

/** Вид занятости: трудовой договор или ГПХ. Закрытый список — по нему считаются итоги «итого ТД / итого ГПХ». */
export const EMPLOYMENTS = { TD: "td", GPH: "gph" } as const;
export type Employment = (typeof EMPLOYMENTS)[keyof typeof EMPLOYMENTS];
export const EMPLOYMENT_LABELS: Record<string, string> = { td: "ТД", gph: "ГПХ" };

/**
 * Как считается оклад: month — оклад за норму часов месяца (все, кроме операторов PRIVA), hourly — тариф в час
 * отдельно за день и ночь (операторы PRIVA: норма у них равна факту).
 */
export const PAY_TYPES = { MONTH: "month", HOURLY: "hourly" } as const;
export type PayType = (typeof PAY_TYPES)[keyof typeof PAY_TYPES];
export const PAY_TYPE_LABELS: Record<string, string> = { month: "Оклад за месяц", hourly: "Почасовой (день/ночь)" };

export interface Department {
  /** Код латиницей: ложится в сотрудников и в Users, не меняется. */
  deptId: string;
  /** Компания (ТОО): rose_farm или esentai. Сотрудник наследует её от подразделения. */
  farm: string;
  name: string;
  order: number;
  /** 5 — пятидневка, 6 — шестидневка (Сборка ГП). Решает, какую норму часов брать из баланса. */
  workWeek: 5 | 6;
  /** Считать ли сверхурочные (часы сверх нормы): в таблице — только Сборка ГП и Защита растений. */
  overtime: boolean;
  /** Коэффициент сверхурочных к часовой ставке (у Сборки ГП — 0,5, у Защиты растений — 1). */
  overtimeRate: number;
  note: string;
  active: boolean;
}

export interface Employee {
  employeeId: string;
  fullName: string;
  deptId: string;
  position: string;
  employment: Employment;
  payType: PayType;
  /** ГГГГ-ММ-ДД; пусто — дата приёма не записана (старые сотрудники из импорта). */
  hiredAt: string;
  /** ГГГГ-ММ-ДД; пусто — работает. Уволенный остаётся в списке ради прошлых месяцев. */
  firedAt: string;
  /** Дорожные: адрес (как в ведомости — «Шабыт», «междуреченск») и ставка в день. */
  travelAddress: string;
  travelRate: number;
  /** ИИН — 12 цифр; пусто — не записан. Ключ для 1С. */
  iin: string;
  note: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Rate {
  rateId: string;
  employeeId: string;
  /** С какого дня действует (ГГГГ-ММ-ДД). Расчёт месяца берёт последнюю ставку, начавшуюся не позже первого числа. */
  from: string;
  /** Официальный оклад — идёт в 1С. */
  salary1c: number;
  /** Неофициальная часть: Total − Salary1C. Хранится, чтобы в таблице читалось глазами; в расчёте берётся Total. */
  kpi: number;
  /** Оговорённая сумма за полный месяц. */
  total: number;
  /** Тариф в час, только для почасовых. */
  dayRate: number;
  nightRate: number;
  note: string;
  setBy: string;
  setAt: string;
}

export interface BalanceMonth {
  /** ГГГГ-ММ */
  month: string;
  days5: number;
  hours5: number;
  days6: number;
  hours6: number;
  updatedBy: string;
  updatedAt: string;
}

export interface Holiday {
  /** ГГГГ-ММ-ДД */
  date: string;
  name: string;
  /** "" — праздник (участвует в переносе), off — дополнительный выходной, work — день объявлен рабочим. */
  kind: "" | "off" | "work";
}

export const HOLIDAY_KIND_LABELS: Record<string, string> = {
  "": "праздник",
  off: "дополнительный выходной",
  work: "рабочий день (отменён выходной)",
};

/** Черновики форм — то, что присылает браузер; проверяет сервер (`rules.ts`). */
export interface DepartmentDraft {
  deptId: string;
  farm: string;
  name: string;
  order: number;
  workWeek: number;
  overtime: boolean;
  overtimeRate: number;
  note: string;
  active: boolean;
}

export interface EmployeeDraft {
  employeeId: string;
  fullName: string;
  deptId: string;
  position: string;
  employment: string;
  payType: string;
  hiredAt: string;
  firedAt: string;
  travelAddress: string;
  travelRate: number;
  iin: string;
  note: string;
}

export interface RateDraft {
  employeeId: string;
  from: string;
  salary1c: number;
  total: number;
  dayRate: number;
  nightRate: number;
  note: string;
}

export interface BalanceDraft {
  month: string;
  days5: number;
  hours5: number;
  days6: number;
  hours6: number;
}
