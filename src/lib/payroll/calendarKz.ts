/**
 * Производственный календарь Казахстана — считается программой, а не вписывается руками (28.10.2026, владелец:
 * «хотелось бы, чтобы баланс рабочего времени ты сам подгружал из актуальных источников и праздничные дни тоже»).
 *
 * Источник правил — закон «О праздниках в Республике Казахстан» и Трудовой кодекс (ст. 85): праздничные дни
 * нерабочие; 7 января (православное Рождество) и первый день Курбан-айта — выходные; праздник, попавший на
 * выходной, переносится на СЛЕДУЮЩИЙ рабочий день. Норма: 40-часовая неделя — пятидневка по 8 часов,
 * шестидневка по 7 часов пн–пт и 5 часов в субботу.
 *
 * Проверено на официальном календаре 2026 года: пятидневка — 246 дней, 1 968 часов; шестидневка — 248 дней по 7 часов
 * и 50 суббот по 5 (1 986 часов). Все помесячные цифры сходятся (`scripts/check-payroll.ts`, раздел «Календарь»).
 *
 * Что программа знать не может — внеплановые переносы, объявленные правительством на конкретный год (например,
 * «работаем в субботу, отдыхаем в понедельник»), и дату Курбан-айта на годы вперёд (она по лунному календарю и
 * утверждается каждый год). Для этого есть вкладка PayrollHolidays: строка с видом «off» — дополнительный выходной,
 * «work» — день объявлен рабочим, пустой вид — праздник (участвует в переносе). Курбан-айт за годы, которых нет в
 * `KURBAN_AIT`, бухгалтер вписывает туда же.
 */

export interface CalendarDay {
  /** ГГГГ-ММ-ДД */
  date: string;
  /** holiday — праздник или выходной по закону, transfer — перенос с выходного, extra — добавлен руками. */
  kind: "holiday" | "transfer" | "extra";
  name: string;
}

export interface ExtraDay {
  date: string;
  name: string;
  /** "" — праздник (с переносом), off — дополнительный выходной (без переноса), work — рабочий день. */
  kind: "" | "off" | "work";
}

/** Праздники по закону: [месяц, день, название]. 7 января — выходной день, не праздник, но для нормы это одно и то же. */
export const KZ_FIXED_HOLIDAYS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 1, "Новый год"],
  [1, 2, "Новый год"],
  [1, 7, "Православное Рождество"],
  [3, 8, "Международный женский день"],
  [3, 21, "Наурыз мейрамы"],
  [3, 22, "Наурыз мейрамы"],
  [3, 23, "Наурыз мейрамы"],
  [5, 1, "Праздник единства народа Казахстана"],
  [5, 7, "День защитника Отечества"],
  [5, 9, "День Победы"],
  [7, 6, "День Столицы"],
  [8, 30, "День Конституции"],
  [10, 25, "День Республики"],
  [12, 16, "День Независимости"],
];

/**
 * Первый день Курбан-айта по годам. confirmed — объявлен официально; остальные — по астрономическому расчёту,
 * бухгалтер подтверждает, когда правительство объявит (можно перебить строкой в PayrollHolidays).
 */
export const KURBAN_AIT: Record<number, { date: string; confirmed: boolean }> = {
  2023: { date: "2023-06-28", confirmed: true },
  2024: { date: "2024-06-16", confirmed: true },
  2025: { date: "2025-06-06", confirmed: true },
  2026: { date: "2026-05-27", confirmed: true },
  2027: { date: "2027-05-16", confirmed: false },
  2028: { date: "2028-05-05", confirmed: false },
  2029: { date: "2029-04-24", confirmed: false },
  2030: { date: "2030-04-13", confirmed: false },
};

export const KURBAN_AIT_NAME = "Курбан-айт";

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 0 — воскресенье … 6 — суббота; считается по UTC, чтобы часовой пояс сервера не сдвигал день. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Выходной ли день недели для данного режима: пятидневка — сб и вс, шестидневка — только вс. */
export function isWeekend(date: string, workWeek: 5 | 6): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || (workWeek === 5 && dow === 6);
}

/** Праздники года по закону плюс Курбан-айт (если известен) плюс добавленные руками праздники — без переносов. */
export function lawHolidays(year: number, extra: ExtraDay[] = []): CalendarDay[] {
  const out: CalendarDay[] = KZ_FIXED_HOLIDAYS.map(([m, d, name]) => ({ date: iso(year, m, d), kind: "holiday", name }));
  const kurban = KURBAN_AIT[year];
  const manualKurban = extra.find((e) => e.kind === "" && /курбан/i.test(e.name) && e.date.startsWith(`${year}-`));
  if (kurban && !manualKurban) {
    out.push({ date: kurban.date, kind: "holiday", name: kurban.confirmed ? KURBAN_AIT_NAME : `${KURBAN_AIT_NAME} (дата предварительная)` });
  }
  for (const e of extra) {
    if (e.kind !== "" || !e.date.startsWith(`${year}-`)) continue;
    if (out.some((h) => h.date === e.date)) continue;
    out.push({ date: e.date, kind: "extra", name: e.name || "праздник" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Нерабочие дни года для режима недели, кроме обычных выходных: праздники, переносы и добавленные выходные.
 * Перенос: праздник попал на выходной этого режима → ближайший следующий день, который не выходной, не праздник
 * и ещё не занят другим переносом, становится выходным. Так 21 марта (суббота) переносится при пятидневке, а при
 * шестидневке — нет: суббота там рабочая. Строка «work» снимает выходной с любого дня.
 */
export function nonWorkingDays(year: number, workWeek: 5 | 6, extra: ExtraDay[] = []): CalendarDay[] {
  const holidays = lawHolidays(year, extra);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const workDecreed = new Set(extra.filter((e) => e.kind === "work" && e.date.startsWith(`${year}-`)).map((e) => e.date));
  const out: CalendarDay[] = [...holidays];
  const taken = new Set(holidaySet);
  for (const h of holidays) {
    if (!isWeekend(h.date, workWeek)) continue;
    let next = addDays(h.date, 1);
    while (isWeekend(next, workWeek) || taken.has(next) || workDecreed.has(next)) next = addDays(next, 1);
    if (!next.startsWith(`${year}-`)) continue;
    taken.add(next);
    out.push({ date: next, kind: "transfer", name: `перенос с ${h.date.slice(8)}.${h.date.slice(5, 7)} (${h.name})` });
  }
  for (const e of extra) {
    if (e.kind !== "off" || !e.date.startsWith(`${year}-`) || taken.has(e.date)) continue;
    taken.add(e.date);
    out.push({ date: e.date, kind: "extra", name: e.name || "дополнительный выходной" });
  }
  return out.filter((d) => !workDecreed.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
}

export interface MonthNorm {
  month: string;
  days5: number;
  hours5: number;
  days6: number;
  hours6: number;
}

/** Норма месяца по календарю: рабочие дни и часы при пятидневке и шестидневке. */
export function monthNorm(month: string, extra: ExtraDay[] = []): MonthNorm {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const off5 = new Set(nonWorkingDays(year, 5, extra).map((d) => d.date));
  const off6 = new Set(nonWorkingDays(year, 6, extra).map((d) => d.date));
  const workDecreed = new Set(extra.filter((e) => e.kind === "work").map((e) => e.date));
  let days5 = 0;
  let days6 = 0;
  let hours6 = 0;
  for (let d = 1; d <= daysInMonth(year, mon); d++) {
    const date = iso(year, mon, d);
    const dow = dayOfWeek(date);
    const decreedWork = workDecreed.has(date);
    if (!off5.has(date) && (decreedWork || !isWeekend(date, 5))) days5 += 1;
    if (!off6.has(date) && (decreedWork || !isWeekend(date, 6))) {
      days6 += 1;
      hours6 += dow === 6 ? 5 : 7;
    }
  }
  return { month, days5, hours5: days5 * 8, days6, hours6 };
}

export function yearNorm(year: number, extra: ExtraDay[] = []): MonthNorm[] {
  return Array.from({ length: 12 }, (_, i) => monthNorm(`${year}-${String(i + 1).padStart(2, "0")}`, extra));
}

/** Праздник ли день (для оплаты ×1,5): по закону, Курбан-айт или добавленный руками праздник. Переносы — нет. */
export function isHoliday(date: string, extra: ExtraDay[] = []): boolean {
  return lawHolidays(Number(date.slice(0, 4)), extra).some((h) => h.date === date);
}

/** Выходной ли день для режима недели (с учётом праздников, переносов и объявленных рабочими). */
export function isDayOff(date: string, workWeek: 5 | 6, extra: ExtraDay[] = []): boolean {
  const year = Number(date.slice(0, 4));
  if (extra.some((e) => e.kind === "work" && e.date === date)) return false;
  if (nonWorkingDays(year, workWeek, extra).some((d) => d.date === date)) return true;
  return isWeekend(date, workWeek);
}

/**
 * Сверка с внешним календарём isdayoff.ru (страна kz, пятидневка): строка по дню года, «0» — рабочий, «1» — выходной.
 * Возвращает даты, где наш календарь и внешний разошлись. Внешний может отставать или ошибаться, поэтому это
 * подсказка бухгалтеру, а не истина.
 */
export function compareWithIsDayOff(year: number, body: string, extra: ExtraDay[] = []): { date: string; ours: boolean; theirs: boolean }[] | null {
  const s = body.trim();
  const total = daysInMonth(year, 2) === 29 ? 366 : 365;
  if (!/^[0-9]+$/.test(s) || s.length !== total) return null;
  const out: { date: string; ours: boolean; theirs: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const date = addDays(`${year}-01-01`, i);
    const theirs = s[i] !== "0";
    const ours = isDayOff(date, 5, extra);
    if (ours !== theirs) out.push({ date, ours, theirs });
  }
  return out;
}
