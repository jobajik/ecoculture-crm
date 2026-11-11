import { FLOWER_ORDER_ALL, compareGrades, getFarmFor } from "./constants";
import { normalizeStore, type StoreCode } from "./officeStore";
import type { Batch } from "./types";

// ---------------------------------------------------------------------------
// «Сорта и ростовки на складе» (12.11.2026, владелец: «срочно — какие сорта и ростовки по складу; видеть розы,
// эустомы и хризантему по сортам, по дате»). Чистый расчёт из партий с остатком: цветок → сорт → ростовка
// (у хризантемы — категория) → день срезки. Страница — `/warehouse/stock`, проверка — `check-stock-matrix`.
// ---------------------------------------------------------------------------

export interface StockMatrixInput {
  batches: Batch[];
  /** «Сегодня» по Алматы — для возраста срезки. */
  today: string;
  /** Зав. складом видит только своё производство (грабли 1.1-ter). */
  farm?: string | null;
  /** Склад: "" — основной, «office», «astana»; "all" — все вместе. */
  store?: StoreCode | "all";
  /** Срезка не раньше / не позже этого дня (ГГГГ-ММ-ДД). */
  from?: string;
  to?: string;
  /** Сколько дней срезки показывать колонками; более ранние складываются в «раньше». */
  maxDates?: number;
}

export interface MatrixLine {
  grade: string;
  total: number;
  byDate: Record<string, number>;
}

export interface MatrixRow {
  variety: string;
  total: number;
  byGrade: Record<string, number>;
  byDate: Record<string, number>;
  /** Самая ранняя и самая поздняя срезка среди партий сорта ("" — дата не записана). */
  oldest: string;
  newest: string;
  lines: MatrixLine[];
}

export interface FlowerMatrix {
  flowerType: string;
  total: number;
  grades: string[];
  /** Дни срезки колонками, свежие первыми; `EARLIER` — всё, что раньше. */
  dates: string[];
  gradeTotals: Record<string, number>;
  dateTotals: Record<string, number>;
  rows: MatrixRow[];
}

export interface StockMatrix {
  total: number;
  varieties: number;
  batches: number;
  flowers: FlowerMatrix[];
  /** Все дни срезки, по которым есть остаток (до фильтра по дате), свежие первыми. */
  dates: { date: string; quantity: number }[];
}

/** Ключ колонки «раньше» и «дата не записана». */
export const EARLIER = "earlier";
export const NO_DATE = "";

/** День срезки партии: дата срезки, а если её нет — день приёмки. */
export function harvestDayOf(b: Pick<Batch, "harvestDate" | "receivedAt">): string {
  const d = String(b.harvestDate || "").slice(0, 10) || String(b.receivedAt || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : NO_DATE;
}

/** Сколько дней назад была срезка; пусто или будущее — 0. */
export function daysAgo(day: string, today: string): number {
  if (!day || !today) return 0;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : 0;
}

const add = (rec: Record<string, number>, key: string, n: number) => {
  rec[key] = (rec[key] ?? 0) + n;
};

export function buildStockMatrix(input: StockMatrixInput): StockMatrix {
  const store = input.store ?? "";
  const maxDates = input.maxDates ?? 10;
  const scoped = input.batches
    .filter((b) => b.quantityRemaining > 0)
    .filter((b) => !input.farm || getFarmFor(b.flowerType) === input.farm)
    .filter((b) => store === "all" || normalizeStore(b.store) === store);

  const allDates: Record<string, number> = {};
  for (const b of scoped) add(allDates, harvestDayOf(b), b.quantityRemaining);

  const live = scoped.filter((b) => {
    const d = harvestDayOf(b);
    if (input.from && (!d || d < input.from)) return false;
    if (input.to && (!d || d > input.to)) return false;
    return true;
  });

  const byFlower = new Map<string, Batch[]>();
  for (const b of live) byFlower.set(b.flowerType, [...(byFlower.get(b.flowerType) ?? []), b]);
  const order = (f: string) => {
    const i = FLOWER_ORDER_ALL.indexOf(f);
    return i === -1 ? FLOWER_ORDER_ALL.length : i;
  };

  const flowers: FlowerMatrix[] = [...byFlower.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([flowerType, list]) => {
      // Колонки дней: свежие `maxDates`, остальное — «раньше»; партии без даты — отдельной колонкой в конце.
      const days = [...new Set(list.map(harvestDayOf).filter(Boolean))].sort().reverse();
      const shown = new Set(days.slice(0, maxDates));
      const colOf = (b: Batch) => {
        const d = harvestDayOf(b);
        return !d ? NO_DATE : shown.has(d) ? d : EARLIER;
      };

      const rows = new Map<string, MatrixRow & { lineMap: Map<string, MatrixLine> }>();
      const gradeTotals: Record<string, number> = {};
      const dateTotals: Record<string, number> = {};
      for (const b of list) {
        const qty = b.quantityRemaining;
        const variety = b.variety.trim() || "Без сорта";
        const grade = b.grade.trim();
        const key = variety.toLowerCase();
        const day = harvestDayOf(b);
        const col = colOf(b);
        const row = rows.get(key) ?? { variety, total: 0, byGrade: {}, byDate: {}, oldest: day, newest: day, lines: [], lineMap: new Map() };
        row.total += qty;
        add(row.byGrade, grade, qty);
        add(row.byDate, col, qty);
        if (day && (!row.oldest || day < row.oldest)) row.oldest = day;
        if (day && (!row.newest || day > row.newest)) row.newest = day;
        const line = row.lineMap.get(grade) ?? { grade, total: 0, byDate: {} };
        line.total += qty;
        add(line.byDate, col, qty);
        row.lineMap.set(grade, line);
        rows.set(key, row);
        add(gradeTotals, grade, qty);
        add(dateTotals, col, qty);
      }

      const dates = [...days.slice(0, maxDates)];
      if (dateTotals[EARLIER]) dates.push(EARLIER);
      if (dateTotals[NO_DATE]) dates.push(NO_DATE);
      return {
        flowerType,
        total: list.reduce((s, b) => s + b.quantityRemaining, 0),
        grades: Object.keys(gradeTotals).sort((a, b) => compareGrades(flowerType, a, b)),
        dates,
        gradeTotals,
        dateTotals,
        rows: [...rows.values()]
          .map(({ lineMap, ...row }) => ({ ...row, lines: [...lineMap.values()].sort((a, b) => compareGrades(flowerType, a.grade, b.grade)) }))
          .sort((a, b) => b.total - a.total || a.variety.localeCompare(b.variety, "ru")),
      };
    });

  return {
    total: flowers.reduce((s, f) => s + f.total, 0),
    varieties: flowers.reduce((s, f) => s + f.rows.length, 0),
    batches: live.length,
    flowers,
    dates: Object.entries(allDates)
      .map(([date, quantity]) => ({ date, quantity }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
  };
}
