import { shiftDay } from "../payroll/work";

/**
 * Период отчёта теплицы (30.10.2026, ТЗ: «ежедневный, недельный, месячный отчёт… за квартал, год, произвольный
 * период»). Чистые функции: адрес → отрезок дат и соседние отрезки для стрелок ‹ ›. Будущее отрезается сегодняшним
 * днём — отчёт о том, чего ещё не было, ничего не скажет.
 */
export type ReportPeriod = "day" | "week" | "month" | "quarter" | "year" | "custom";
export const REPORT_PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: "day", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "quarter", label: "Квартал" },
  { key: "year", label: "Год" },
  { key: "custom", label: "Свой период" },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export interface ReportRange {
  period: ReportPeriod;
  from: string;
  to: string;
  /** Опорный день: от него считаются соседние отрезки. */
  anchor: string;
  title: string;
  prevAnchor: string | null;
  nextAnchor: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function bounds(period: Exclude<ReportPeriod, "custom">, anchor: string): { from: string; to: string; title: string } {
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  if (period === "day") return { from: anchor, to: anchor, title: longDate(anchor) };
  if (period === "week") {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    const from = shiftDay(anchor, -dow);
    const to = shiftDay(from, 6);
    return { from, to, title: `Неделя ${longDate(from).replace(` ${from.slice(0, 4)}`, "")} — ${longDate(to)}` };
  }
  if (period === "month") return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, title: `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}` };
  if (period === "quarter") {
    const q = Math.floor((m - 1) / 3);
    const fm = q * 3 + 1;
    return { from: `${y}-${pad(fm)}-01`, to: `${y}-${pad(fm + 2)}-${pad(lastDay(y, fm + 2))}`, title: `${q + 1}-й квартал ${y}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, title: `${y} год` };
}

function shiftAnchor(period: Exclude<ReportPeriod, "custom">, from: string, dir: -1 | 1): string {
  if (period === "day") return shiftDay(from, dir);
  if (period === "week") return shiftDay(from, dir * 7);
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const step = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  const total = y * 12 + (m - 1) + dir * step;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

export function reportRange(params: { period?: string; date?: string; from?: string; to?: string }, today: string): ReportRange {
  const period: ReportPeriod = REPORT_PERIODS.some((p) => p.key === params.period) ? (params.period as ReportPeriod) : "month";
  if (period === "custom") {
    let from = params.from && ISO.test(params.from) ? params.from : shiftDay(today, -29);
    let to = params.to && ISO.test(params.to) ? params.to : today;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (Math.round((Date.parse(to) - Date.parse(from)) / 86400000) > MAX_DAYS) from = shiftDay(to, -MAX_DAYS);
    return { period, from, to, anchor: to, title: `${longDate(from)} — ${longDate(to)}`, prevAnchor: null, nextAnchor: null };
  }
  let anchor = params.date && ISO.test(params.date) ? params.date : today;
  if (anchor > today) anchor = today;
  const b = bounds(period, anchor);
  const next = shiftAnchor(period, b.from, 1);
  return {
    period,
    from: b.from,
    to: b.to > today ? today : b.to,
    anchor,
    title: b.title,
    prevAnchor: shiftAnchor(period, b.from, -1),
    nextAnchor: next <= today ? next : null,
  };
}
