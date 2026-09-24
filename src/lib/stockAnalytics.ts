import {
  FLOWER_TYPE_LABELS,
  FLOWER_TYPE_LABELS_PLURAL,
  compareGrades,
  formatGrade,
  getFarmFor,
  periodShift,
  weeksOfMonth,
} from "./constants";
import type { Batch, OrderWithItems, Settings, Shipment, StaffTakeout, Writeoff } from "./types";
import { isRetailOrder } from "./retail";
import { isRegionOrder } from "./orderKind";
import { computeBatchStorageInfo } from "./shelfLife";

/**
 * Аналитика склада за месяц — «Склад → Аналитика».
 *
 * Отвечает на вопросы владельца про движение цветка: сколько пришло, куда
 * ушло (клиентам, в наши магазины, опт на город, в списание, сотрудникам и на
 * нужды), что осталось и на сколько дней этого хватит, где теряем.
 *
 * Как считается:
 *  - приход — по дню ПРИЁМКИ партии; отгрузка, списание — по дню записи;
 *    выдача — по дню выдачи;
 *  - остаток на начало и конец месяца восстанавливается по движениям: всё
 *    принятое до дня минус всё ушедшее до дня. Так «начало + приход − расход =
 *    конец» сходится всегда, а живой остаток партий сверяется отдельно —
 *    расхождение показывается строкой, а не прячется (`unexplained`);
 *  - строка отгрузки с минусом — возврат: она уменьшает «отгружено»;
 *  - вид отгрузки берётся из заявки: наш магазин, опт на город или клиент;
 *  - зав. складом видит только своё производство (грабли 1.1-ter) — фильтр
 *    по цветку партии стоит здесь, в расчёте, а не на странице.
 *
 * Функция чистая, проверка — `scripts/check-stock-analytics.ts`.
 */

export interface StockFlow {
  opening: number;
  received: number;
  /** Часть прихода — первая загрузка остатков в программу (если она в этом месяце). */
  initialLoad: number;
  initialLoadDay: string;
  toClients: number;
  toShops: number;
  toRegions: number;
  writtenOff: number;
  toStaff: number;
  toCompany: number;
  closing: number;
  /** Сколько дней месяца учтено (для текущего — по сегодня). */
  days: number;
}

export interface StockRow {
  key: string;
  label: string;
  received: number;
  shipped: number;
  writtenOff: number;
  /** Сотрудникам и на нужды компании. */
  other: number;
  prevShipped: number;
  /** Остаток партий СЕЙЧАС. */
  stockNow: number;
  /** Из него лежит дольше срока хранения. */
  expiredNow: number;
  /** Списано от прихода, 0–100; null — прихода не было. */
  writeoffPercent: number | null;
  /** На сколько дней хватит остатка при темпе отгрузок этого месяца; null — отгрузок не было. */
  coverDays: number | null;
}

export interface WeekRow {
  label: string;
  received: number;
  shipped: number;
  writtenOff: number;
  hasInitialLoad: boolean;
  /** Неделя ещё не наступила. */
  future: boolean;
}

export interface StockAnalytics {
  period: string;
  prevPeriod: string;
  current: StockFlow;
  previous: StockFlow;
  shipped: number;
  prevShipped: number;
  /** Живой остаток партий сейчас минус остаток по движениям на сегодня (только для текущего месяца). */
  unexplained: number;
  stockNow: number;
  expiredNow: number;
  warningNow: number;
  coverDays: number | null;
  byFlower: StockRow[];
  byGrade: StockRow[];
  byVariety: StockRow[];
  weeks: WeekRow[];
  /** Где списали больше всего за месяц: сорт + ростовка. */
  losses: StockRow[];
}

const day = (s: string) => (s || "").slice(0, 10);
const monthOf = (s: string) => (s || "").slice(0, 7);

function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(d).padStart(2, "0")}`;
}

function daysBetweenKeys(a: string, b: string): number {
  const t = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

type Kind = "clients" | "shops" | "regions" | "writeoff" | "staff" | "company";

interface Move {
  day: string;
  batch: Batch;
  qty: number;
  kind: Kind;
}

export function buildStockAnalytics(input: {
  batches: Batch[];
  shipments: Shipment[];
  writeoffs: Writeoff[];
  takeouts: StaffTakeout[];
  orders: OrderWithItems[];
  settings: Settings;
  /** «2026-09» */
  period: string;
  /** «Сегодня» по Алматы. */
  today: string;
  /** Пусто — все производства; иначе только цветки этого производства. */
  farm?: string | null;
  now?: Date;
}): StockAnalytics {
  const { period, today, farm } = input;
  const prevPeriod = periodShift(period, -1);
  // Начало данных считаем по ВСЕЙ базе, а не по отфильтрованной: загрузка
  // остатков была одна на обе теплицы.
  const dataStart = input.batches.reduce((min, b) => {
    const d = day(b.receivedAt);
    return d && (!min || d < min) ? d : min;
  }, "");

  const own = (b: Batch | undefined): b is Batch => !!b && (!farm || getFarmFor(b.flowerType) === farm);
  const batches = input.batches.filter((b) => own(b));
  const byId = new Map(batches.map((b) => [b.batchId, b]));
  const orderById = new Map(input.orders.map((o) => [o.orderId, o]));

  const moves: Move[] = [];
  for (const s of input.shipments) {
    const b = byId.get(s.batchId);
    if (!b) continue;
    const o = orderById.get(s.orderId);
    const kind: Kind = o && isRetailOrder(o) ? "shops" : o && isRegionOrder(o) ? "regions" : "clients";
    moves.push({ day: day(s.createdAt), batch: b, qty: s.quantity, kind });
  }
  for (const w of input.writeoffs) {
    const b = byId.get(w.batchId);
    if (b) moves.push({ day: day(w.createdAt), batch: b, qty: w.quantity, kind: "writeoff" });
  }
  for (const t of input.takeouts) {
    const b = byId.get(t.batchId);
    if (b) moves.push({ day: day(t.date || t.createdAt), batch: b, qty: t.quantity, kind: t.kind === "company" ? "company" : "staff" });
  }

  /** Остаток по движениям на конец дня `d` (включительно). */
  const stockAt = (d: string) =>
    batches.reduce((s, b) => s + (day(b.receivedAt) <= d ? b.quantityIn : 0), 0) -
    moves.reduce((s, m) => s + (m.day && m.day <= d ? m.qty : 0), 0);

  function flowOf(p: string): StockFlow {
    const start = `${p}-01`;
    const endOfMonth = lastDayOf(p);
    const end = today < endOfMonth ? (today < start ? start : today) : endOfMonth;
    const inMonth = (d: string) => monthOf(d) === p;
    const received = batches.filter((b) => inMonth(day(b.receivedAt))).reduce((s, b) => s + b.quantityIn, 0);
    const initialLoad = dataStart && inMonth(dataStart)
      ? batches.filter((b) => day(b.receivedAt) === dataStart).reduce((s, b) => s + b.quantityIn, 0)
      : 0;
    const sum = (k: Kind) => moves.filter((m) => m.kind === k && inMonth(m.day)).reduce((s, m) => s + m.qty, 0);
    const prevDay = (() => {
      const [y, m] = p.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1, 0));
      return d.toISOString().slice(0, 10);
    })();
    return {
      opening: stockAt(prevDay),
      received,
      initialLoad,
      initialLoadDay: initialLoad > 0 ? dataStart : "",
      toClients: sum("clients"),
      toShops: sum("shops"),
      toRegions: sum("regions"),
      writtenOff: sum("writeoff"),
      toStaff: sum("staff"),
      toCompany: sum("company"),
      closing: stockAt(end),
      days: today < start ? 0 : daysBetweenKeys(start, end) + 1,
    };
  }

  const current = flowOf(period);
  const previous = flowOf(prevPeriod);
  const shippedOf = (f: StockFlow) => f.toClients + f.toShops + f.toRegions;
  const shipped = shippedOf(current);

  const stockNowTotal = batches.reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0);
  const isCurrent = today >= `${period}-01` && today <= lastDayOf(period);
  const unexplained = isCurrent ? stockNowTotal - stockAt(today) : 0;

  const now = input.now ?? new Date();
  const info = new Map(batches.map((b) => [b.batchId, computeBatchStorageInfo(b, input.settings, now)]));
  const expired = (b: Batch) => (info.get(b.batchId)?.status === "critical" ? Math.max(0, b.quantityRemaining) : 0);
  const warning = (b: Batch) => (info.get(b.batchId)?.status === "warning" ? Math.max(0, b.quantityRemaining) : 0);

  const cover = (stock: number, shippedInPeriod: number, days: number) =>
    shippedInPeriod > 0 && days > 0 ? stock / (shippedInPeriod / days) : null;

  // --- Разрезы ----------------------------------------------------------------
  const FLOWER_SORT: Record<string, number> = { rose: 1, chrysanthemum: 2, eustoma: 3 };
  const fs = (f: string) => FLOWER_SORT[f] ?? 9;
  const flower = (f: string) => FLOWER_TYPE_LABELS[f] ?? f;

  interface Key {
    key: string;
    label: string;
    flowerType: string;
    grade: string;
    variety: string;
  }
  function rowsBy(keyOf: (b: Batch) => Key): StockRow[] {
    const map = new Map<string, { k: Key; r: StockRow }>();
    const get = (b: Batch) => {
      const k = keyOf(b);
      let a = map.get(k.key);
      if (!a) {
        a = {
          k,
          r: {
            key: k.key, label: k.label, received: 0, shipped: 0, writtenOff: 0, other: 0,
            prevShipped: 0, stockNow: 0, expiredNow: 0, writeoffPercent: null, coverDays: null,
          },
        };
        map.set(k.key, a);
      }
      return a.r;
    };
    for (const b of batches) {
      const r = get(b);
      if (monthOf(day(b.receivedAt)) === period) r.received += b.quantityIn;
      r.stockNow += Math.max(0, b.quantityRemaining);
      r.expiredNow += expired(b);
    }
    for (const m of moves) {
      const r = get(m.batch);
      const mon = monthOf(m.day);
      if (mon === period) {
        if (m.kind === "writeoff") r.writtenOff += m.qty;
        else if (m.kind === "staff" || m.kind === "company") r.other += m.qty;
        else r.shipped += m.qty;
      } else if (mon === prevPeriod && (m.kind === "clients" || m.kind === "shops" || m.kind === "regions")) {
        r.prevShipped += m.qty;
      }
    }
    return Array.from(map.values())
      .filter(({ r }) => r.received || r.shipped || r.writtenOff || r.other || r.stockNow || r.prevShipped)
      .sort(
        (x, y) =>
          fs(x.k.flowerType) - fs(y.k.flowerType) ||
          compareGrades(x.k.flowerType, x.k.grade, y.k.grade) ||
          x.k.variety.localeCompare(y.k.variety, "ru")
      )
      .map(({ r }) => ({
        ...r,
        writeoffPercent: r.received > 0 ? (r.writtenOff / r.received) * 100 : null,
        coverDays: r.stockNow > 0 ? cover(r.stockNow, r.shipped, current.days) : null,
      }));
  }

  const byFlower = rowsBy((b) => ({
    key: b.flowerType,
    label: FLOWER_TYPE_LABELS_PLURAL[b.flowerType] ?? b.flowerType,
    flowerType: b.flowerType,
    grade: "",
    variety: "",
  }));
  const byGrade = rowsBy((b) => ({
    key: `${b.flowerType}|${b.grade}`,
    label: `${flower(b.flowerType)} ${formatGrade(b.grade)}`,
    flowerType: b.flowerType,
    grade: b.grade,
    variety: "",
  }));
  // Сорта — от крупных к мелким: их два десятка, и порядок «по алфавиту» прятал бы главное.
  const byVariety = rowsBy((b) => ({
    key: `${b.flowerType}|${b.variety}`,
    label: `${flower(b.flowerType)} ${b.variety}`,
    flowerType: b.flowerType,
    grade: "",
    variety: b.variety,
  })).sort((a, b) => b.received + b.stockNow - (a.received + a.stockNow));

  const losses = rowsBy((b) => ({
    key: `${b.flowerType}|${b.variety}|${b.grade}`,
    label: `${flower(b.flowerType)} ${b.variety} · ${formatGrade(b.grade)}`,
    flowerType: b.flowerType,
    grade: b.grade,
    variety: b.variety,
  }))
    .filter((r) => r.writtenOff > 0)
    .sort((a, b) => b.writtenOff - a.writtenOff)
    .slice(0, 8);

  // --- Недели -----------------------------------------------------------------
  const weeks: WeekRow[] = weeksOfMonth(period).map((w) => {
    const inW = (d: string) => d >= w.from && d <= w.to;
    return {
      label: w.label,
      received: batches.filter((b) => inW(day(b.receivedAt))).reduce((s, b) => s + b.quantityIn, 0),
      shipped: moves.filter((m) => inW(m.day) && (m.kind === "clients" || m.kind === "shops" || m.kind === "regions")).reduce((s, m) => s + m.qty, 0),
      writtenOff: moves.filter((m) => inW(m.day) && m.kind === "writeoff").reduce((s, m) => s + m.qty, 0),
      hasInitialLoad: !!dataStart && inW(dataStart),
      future: w.from > today,
    };
  });

  return {
    period,
    prevPeriod,
    current,
    previous,
    shipped,
    prevShipped: shippedOf(previous),
    unexplained,
    stockNow: stockNowTotal,
    expiredNow: batches.reduce((s, b) => s + expired(b), 0),
    warningNow: batches.reduce((s, b) => s + warning(b), 0),
    coverDays: cover(isCurrent ? stockNowTotal : current.closing, shipped, current.days),
    byFlower,
    byGrade,
    byVariety,
    weeks,
    losses,
  };
}
