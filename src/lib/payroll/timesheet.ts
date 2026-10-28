/**
 * Табель учёта рабочего времени — чистые правила (этап 2, 28.10.2026).
 *
 * Табель заполняет начальник подразделения по дням: в ячейке — часы (8, 7, 5, 24, 8,5) или код. Коды взяты из
 * старых табелей книги «Расчётная ведомость ТОО Rose Farm», в которой их писали по-разному: «бс», «б-с», «Б/С»,
 * «б/с» — одно и то же; «п» и «П» — прогул; «B» латиницей — выходной. Всё это приводится к одному написанию при
 * вводе (`normalizeCell`), чтобы итоги считались, а не терялись.
 *
 * Итоги строки повторяют колонки старого табеля (Отпуск, Больничный, Командировка, Прогул, Сверхурочные,
 * Праздничных) и сверены с ним на июле 2024: Сборка ГП, Орынбаева Д. — 261 час, праздничных 11, сверхурочных
 * 261 − 11 − 176 = 74 (`scripts/check-payroll.ts`, раздел «Табель»). Деньги здесь не считаются — это этап 3.
 */

import { isDayOff, isHoliday, daysInMonth, dayOfWeek, type ExtraDay } from "./calendarKz";
import { seesDepartment, type PayrollScope } from "./access";
import type { Employee } from "./types";

export const TIMESHEET_CODES = {
  "Б": "Больничный",
  "БС": "Без содержания",
  "О": "Отпуск",
  "К": "Командировка",
  "П": "Прогул",
  "В": "Выходной",
  "У": "Уволен",
  "Д": "Дневная смена (норма дня)",
} as const;
export type TimesheetCode = keyof typeof TIMESHEET_CODES;
const CODES = Object.keys(TIMESHEET_CODES) as TimesheetCode[];

/** Состояние табеля подразделения за месяц. "" — черновик. */
export type TimesheetStatus = "" | "submitted" | "approved" | "returned";
export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  "": "черновик",
  submitted: "на проверке",
  approved: "принят",
  returned: "возвращён",
};

export const SHIFT_LABELS: Record<string, string> = { "": "", night: "ночь" };

/**
 * Ячейка в одном написании: "" — пусто, "8" / "8.5" — часы, код из `TIMESHEET_CODES` — код; null — непонятно.
 * Латинские двойники (B, O, K) и запятая в дробных часах понимаются.
 */
export function normalizeCell(raw: string): string | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s/\\-]+/g, "")
    .replace(/B/g, "В")
    .replace(/O/g, "О")
    .replace(/K/g, "К")
    .replace(/Y/g, "У");
  if (s === "") return "";
  if ((CODES as string[]).includes(s)) return s;
  const n = Number(s.replace(",", "."));
  if (!/^\d+([.,]\d+)?$/.test(s) || !Number.isFinite(n)) return null;
  if (n > 24) return null;
  if (n === 0) return "";
  return String(Math.round(n * 100) / 100);
}

export function cellHours(cell: string): number | null {
  if (cell === "" || (CODES as string[]).includes(cell)) return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

/** Дни месяца в одну ячейку таблицы: «8|8||Б|…». Хвост пустых дней обрезается. */
export function encodeDays(cells: string[]): string {
  const out = [...cells];
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("|");
}

export function decodeDays(raw: string, days: number): string[] {
  const parts = String(raw ?? "").split("|");
  return Array.from({ length: days }, (_, i) => normalizeCell(parts[i] ?? "") ?? "");
}

export function monthDays(month: string): string[] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return Array.from({ length: daysInMonth(y, m) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Сколько часов в обычный рабочий день режима: пятидневка — 8, шестидневка — 7 в будни и 5 в субботу. */
export function scheduleHours(date: string, workWeek: 5 | 6): number {
  if (workWeek === 6) return dayOfWeek(date) === 6 ? 5 : 7;
  return 8;
}

/** Работал ли человек в этот день по датам приёма и увольнения (день увольнения — ещё рабочий). */
export function employedOn(date: string, hiredAt: string, firedAt: string): boolean {
  if (hiredAt && date < hiredAt) return false;
  if (firedAt && date > firedAt) return false;
  return true;
}

export interface DayInfo {
  date: string;
  /** 1–31 */
  day: number;
  /** пн, вт… */
  weekday: string;
  off: boolean;
  holiday: boolean;
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Шапка табеля: дни месяца с выходными и праздниками режима подразделения. */
export function dayInfos(month: string, workWeek: 5 | 6, extra: ExtraDay[] = []): DayInfo[] {
  return monthDays(month).map((date) => ({
    date,
    day: Number(date.slice(8)),
    weekday: WEEKDAYS[dayOfWeek(date)],
    off: isDayOff(date, workWeek, extra),
    holiday: isHoliday(date, extra),
  }));
}

/**
 * «Заполнить по графику»: пустые рабочие дни — часами режима, выходные и праздники остаются пустыми. Заполненное
 * руками не трогается, дни до приёма и после увольнения — тоже. `until` — не дальше этого дня (сегодня): будущее
 * не заполняется заранее, табель ведут по факту.
 */
export function fillBySchedule(cells: string[], days: DayInfo[], workWeek: 5 | 6, hiredAt = "", firedAt = "", until = ""): string[] {
  return cells.map((c, i) => {
    const d = days[i];
    if (!d || c !== "" || d.off || !employedOn(d.date, hiredAt, firedAt)) return c;
    if (until && d.date > until) return c;
    return String(scheduleHours(d.date, workWeek));
  });
}

/** Пустые рабочие дни до `until` включительно — то, что начальник, скорее всего, забыл отметить. */
export function missingWorkDays(cells: string[], days: DayInfo[], hiredAt = "", firedAt = "", until = ""): number {
  let n = 0;
  days.forEach((d, i) => {
    if (until && d.date > until) return;
    if (d.off || !employedOn(d.date, hiredAt, firedAt)) return;
    if ((cells[i] ?? "") === "") n += 1;
  });
  return n;
}

export interface RowSummary {
  /** Дней с часами (в том числе «Д»). */
  workDays: number;
  hours: number;
  /** Часы, отработанные в праздники по закону (оплата ×1,5 — этап 3). */
  holidayHours: number;
  /** Сверх нормы: часы − праздничные − личная норма; только у подразделений со сверхурочными, не меньше нуля. */
  overtime: number;
  /** Личная норма часов: рабочие дни режима в пределах работы, без отпуска, больничного, командировки, БС и «У». */
  normHours: number;
  vacation: number;
  sick: number;
  trip: number;
  absent: number;
  unpaid: number;
}

/**
 * Итоги строки табеля. `dayShiftHours` — сколько часов стоит «Д»: норма часов месяца ÷ норма дней (решение
 * владельца: «сам автоматически считай, как правильно от месяца к месяцу»).
 */
export function summarizeRow(
  cells: string[],
  days: DayInfo[],
  opts: { workWeek: 5 | 6; overtime: boolean; dayShiftHours: number; hiredAt?: string; firedAt?: string }
): RowSummary {
  const s: RowSummary = { workDays: 0, hours: 0, holidayHours: 0, overtime: 0, normHours: 0, vacation: 0, sick: 0, trip: 0, absent: 0, unpaid: 0 };
  days.forEach((d, i) => {
    const c = cells[i] ?? "";
    const within = employedOn(d.date, opts.hiredAt ?? "", opts.firedAt ?? "");
    const excused = c === "О" || c === "Б" || c === "К" || c === "БС" || c === "У";
    if (within && !d.off && !excused) s.normHours += scheduleHours(d.date, opts.workWeek);
    if (c === "О") s.vacation += 1;
    else if (c === "Б") s.sick += 1;
    else if (c === "К") s.trip += 1;
    else if (c === "П") s.absent += 1;
    else if (c === "БС") s.unpaid += 1;
    const h = c === "Д" ? opts.dayShiftHours : cellHours(c);
    if (h && h > 0) {
      s.workDays += 1;
      s.hours += h;
      if (d.holiday) s.holidayHours += h;
    }
  });
  s.hours = Math.round(s.hours * 100) / 100;
  s.holidayHours = Math.round(s.holidayHours * 100) / 100;
  if (opts.overtime) s.overtime = Math.max(0, Math.round((s.hours - s.holidayHours - s.normHours) * 100) / 100);
  return s;
}

/** Часы «Д»: норма часов ÷ норма дней месяца, до сотых. */
export function dayShiftHours(normHours: number, normDays: number): number {
  return normDays > 0 ? Math.round((normHours / normDays) * 100) / 100 : 8;
}

/** «У» ставится в день увольнения и дальше: остаток месяца заполняется сам. */
export function applyFired(cells: string[], index: number): string[] {
  return cells.map((c, i) => (i >= index ? "У" : c));
}

// --- Права ----------------------------------------------------------------------

/**
 * Кто правит табель: начальник своего подразделения — пока табель черновик или возвращён; бухгалтер и админ —
 * всегда (исправить при проверке). Кадровик и агроном смотрят.
 */
export function timesheetEditRefusal(scope: PayrollScope | null, deptId: string, status: TimesheetStatus): string {
  if (!scope) return "Нет доступа к разделу «Зарплата».";
  if (!seesDepartment(scope, deptId)) return "Это табель чужого подразделения.";
  if (scope.kind === "admin" || scope.kind === "accountant") return "";
  if (scope.kind !== "head") return "Табель заполняют начальники подразделений, проверяет бухгалтер.";
  if (status === "submitted") return "Табель отправлен на проверку — править его сейчас может бухгалтер. Попросите вернуть, если нужно исправить.";
  if (status === "approved") return "Табель принят бухгалтером — правки уже не принимаются. Попросите бухгалтера вернуть его.";
  return "";
}

export type TimesheetMove = "submit" | "approve" | "return" | "reopen";

/** Переходы состояния: отправить (начальник, из черновика или возврата), принять и вернуть (бухгалтер, админ). */
export function timesheetMoveRefusal(scope: PayrollScope | null, deptId: string, status: TimesheetStatus, move: TimesheetMove, comment: string): string {
  if (!scope) return "Нет доступа к разделу «Зарплата».";
  if (!seesDepartment(scope, deptId)) return "Это табель чужого подразделения.";
  const reviewer = scope.kind === "admin" || scope.kind === "accountant";
  switch (move) {
    case "submit":
      if (scope.kind !== "head" && !reviewer) return "Отправляет табель начальник подразделения.";
      if (status === "submitted") return "Табель уже на проверке.";
      if (status === "approved") return "Табель уже принят.";
      return "";
    case "approve":
      if (!reviewer) return "Принимает табель бухгалтер по зарплате.";
      if (status === "approved") return "Табель уже принят.";
      return "";
    case "return":
      if (!reviewer) return "Вернуть табель может бухгалтер по зарплате.";
      if (status !== "submitted" && status !== "approved") return "Вернуть можно только отправленный или принятый табель.";
      if (!comment.trim()) return "Напишите, что исправить, — начальник увидит это над табелем.";
      return "";
    case "reopen":
      if (!reviewer) return "Открыть табель снова может бухгалтер по зарплате.";
      if (status !== "approved") return "Открыть заново можно только принятый табель.";
      return "";
  }
}

export function nextStatus(move: TimesheetMove): TimesheetStatus {
  return move === "submit" ? "submitted" : move === "approve" ? "approved" : move === "return" ? "returned" : "";
}

/** Месяц ГГГГ-ММ со сдвигом. */
export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  const name = MONTHS[m - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

/** Ячейки, которые прислал браузер, — в одном написании; непонятная → текст ошибки «строка, день». */
export function cleanRowCells(cells: string[], days: number, label: string): { cells: string[]; error: string } {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const v = normalizeCell(cells[i] ?? "");
    if (v === null) return { cells: [], error: `${label}, ${i + 1} число: «${cells[i]}» — непонятная отметка. Пишите часы (до 24) или код: ${CODES.join(", ")}.` };
    out.push(v);
  }
  return { cells: out, error: "" };
}

// --- Кто в табеле ------------------------------------------------------------------

export interface TimesheetPerson {
  key: string;
  employeeId: string;
  shift: "" | "night";
  fullName: string;
  position: string;
  hiredAt: string;
  firedAt: string;
  hourly: boolean;
}

export function rowKey(employeeId: string, shift: string): string {
  return `${employeeId}|${shift === "night" ? "night" : ""}`;
}

/**
 * Строки табеля подразделения за месяц: сотрудники подразделения, работавшие в месяце хотя бы день, плюс те, у кого
 * табель этого месяца уже заполнен здесь (перевели в другое подразделение позже — заполненное не пропадает).
 * Почасовым (операторы PRIVA) — две строки: день и ночь, как в старом табеле.
 */
export function timesheetPeople(
  employees: Employee[],
  deptId: string,
  month: string,
  filled: { employeeId: string; deptId: string }[] = []
): TimesheetPerson[] {
  const first = `${month}-01`;
  const last = `${month}-31`;
  const filledHere = new Set(filled.filter((f) => f.deptId === deptId).map((f) => f.employeeId));
  const list = employees.filter((e) => {
    if (filledHere.has(e.employeeId)) return true;
    if (e.deptId !== deptId) return false;
    if (e.hiredAt && e.hiredAt > last) return false;
    if (e.firedAt && e.firedAt < first) return false;
    return true;
  });
  const out: TimesheetPerson[] = [];
  for (const e of [...list].sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"))) {
    const base = { employeeId: e.employeeId, fullName: e.fullName, position: e.position, hiredAt: e.hiredAt, firedAt: e.firedAt, hourly: e.payType === "hourly" };
    out.push({ ...base, key: rowKey(e.employeeId, ""), shift: "" });
    if (base.hourly) out.push({ ...base, key: rowKey(e.employeeId, "night"), shift: "night" });
  }
  return out;
}
