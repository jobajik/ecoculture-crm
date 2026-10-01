/**
 * «Продажи → Цветы»: что продали за месяц в разрезе цветка, ростовки или
 * категории, сорта и менеджера (октябрь 2026, владелец: «статистику по
 * проданным цветкам в разрезе категории, ростовки и прочего — в продажах»).
 *
 * Правила те же, что у всех продаж: месяц — по дню ОФОРМЛЕНИЯ заявки (по
 * Алматы), отменённые, наши магазины, опт на город и точка на базаре не
 * продажа (`isNotASale`). Точка на базаре показывается отдельной строкой у
 * менеджеров — это перемещение, в итоги и доли она не входит.
 *
 * Чистая функция: страница читает таблицу один раз и передаёт сюда.
 */
import { ORDER_STATUSES, FLOWER_TYPE_LABELS, compareGrades, formatGrade, periodShift } from "./constants";
import { isConsignment, isNotASale } from "./orderKind";
import { localDayKey } from "./timezone";
import type { OrderWithItems } from "./types";

export const POINT_ROW_KEY = "__point__";

export interface FlowerSalesRow {
  key: string;
  label: string;
  /** Для строки сорта или ростовки при «всех цветках» — какой это цветок. */
  flowerType?: string;
  stems: number;
  amount: number;
  orders: number;
  /** Доля в стеблях от итога выбранного среза, 0..100. */
  share: number;
  prevStems: number;
  /** Строка «для справки» (точка на базаре): в итог не входит. */
  aside?: boolean;
}

export interface FlowerSalesMatrix {
  grades: string[];
  rows: { key: string; label: string; cells: Record<string, number>; total: number; aside?: boolean }[];
  totals: Record<string, number>;
}

export interface FlowerSalesReport {
  period: string;
  prevPeriod: string;
  flower: string | null;
  totals: { stems: number; amount: number; orders: number; clients: number };
  prevTotals: { stems: number; amount: number; orders: number };
  byFlower: FlowerSalesRow[];
  byGrade: FlowerSalesRow[];
  byVariety: FlowerSalesRow[];
  byManager: FlowerSalesRow[];
  /** Менеджер × ростовка/категория — только когда выбран один цветок. */
  matrix: FlowerSalesMatrix | null;
}

type Line = {
  orderId: string;
  clientKey: string;
  manager: string;
  point: boolean;
  flowerType: string;
  variety: string;
  grade: string;
  stems: number;
  amount: number;
};

const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];
const flowerRank = (t: string) => {
  const i = FLOWER_ORDER.indexOf(t);
  return i === -1 ? FLOWER_ORDER.length : i;
};

function monthOfOrder(o: Pick<OrderWithItems, "createdAt">): string {
  if (!o.createdAt) return "";
  const d = new Date(o.createdAt);
  return Number.isNaN(d.getTime()) ? "" : localDayKey(d).slice(0, 7);
}

function linesOf(
  orders: OrderWithItems[],
  month: string,
  flower: string | null,
  nameOf: (email: string) => string
): Line[] {
  const out: Line[] = [];
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    if (monthOfOrder(o) !== month) continue;
    const point = isConsignment(o);
    if (!point && isNotASale(o)) continue;
    for (const it of o.items) {
      if (flower && it.flowerType !== flower) continue;
      const stems = Number(it.quantity) || 0;
      if (stems <= 0) continue;
      out.push({
        orderId: o.orderId,
        clientKey: o.clientId || o.clientName || o.orderId,
        manager: nameOf(o.managerEmail || ""),
        point,
        flowerType: it.flowerType,
        variety: (it.variety || "").trim() || "без сорта",
        grade: (it.grade || "").trim(),
        stems,
        amount: stems * (Number(it.unitPrice) || 0),
      });
    }
  }
  return out;
}

type Acc = { label: string; flowerType?: string; stems: number; amount: number; orders: Set<string> };

function group(lines: Line[], keyOf: (l: Line) => string, labelOf: (l: Line) => string, withFlower = false) {
  const map = new Map<string, Acc>();
  for (const l of lines) {
    const key = keyOf(l);
    const a = map.get(key) ?? { label: labelOf(l), flowerType: withFlower ? l.flowerType : undefined, stems: 0, amount: 0, orders: new Set() };
    a.stems += l.stems;
    a.amount += l.amount;
    a.orders.add(l.orderId);
    map.set(key, a);
  }
  return map;
}

function toRows(cur: Map<string, Acc>, prev: Map<string, Acc>, total: number): FlowerSalesRow[] {
  return Array.from(cur.entries()).map(([key, a]) => ({
    key,
    label: a.label,
    flowerType: a.flowerType,
    stems: a.stems,
    amount: a.amount,
    orders: a.orders.size,
    share: total > 0 ? (a.stems / total) * 100 : 0,
    prevStems: prev.get(key)?.stems ?? 0,
  }));
}

const gradeLabel = (flowerType: string, grade: string) => (grade ? formatGrade(grade) : `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType}: без ростовки`);

export function buildFlowerSales(input: {
  orders: OrderWithItems[];
  period: string;
  /** Код цветка или null — все. */
  flower: string | null;
  nameByEmail: Map<string, string>;
}): FlowerSalesReport {
  const { orders, period } = input;
  const flower = input.flower && FLOWER_TYPE_LABELS[input.flower] ? input.flower : null;
  const prevPeriod = periodShift(period, -1);
  const nameOf = (email: string) => input.nameByEmail.get(email.toLowerCase()) || email || "—";

  const allCur = linesOf(orders, period, flower, nameOf);
  const allPrev = linesOf(orders, prevPeriod, flower, nameOf);
  const cur = allCur.filter((l) => !l.point);
  const prev = allPrev.filter((l) => !l.point);

  const sum = (ls: Line[]) => ({
    stems: ls.reduce((s, l) => s + l.stems, 0),
    amount: ls.reduce((s, l) => s + l.amount, 0),
    orders: new Set(ls.map((l) => l.orderId)).size,
  });
  const t = sum(cur);
  const totals = { ...t, clients: new Set(cur.map((l) => l.clientKey)).size };
  const prevTotals = sum(prev);

  // Цветы
  const fKey = (l: Line) => l.flowerType;
  const fLabel = (l: Line) => FLOWER_TYPE_LABELS[l.flowerType] ?? l.flowerType;
  const byFlower = toRows(group(cur, fKey, fLabel), group(prev, fKey, fLabel), t.stems).sort(
    (a, b) => flowerRank(a.key) - flowerRank(b.key)
  );

  // Ростовка / категория: у разных цветков «50» — разные позиции, ключ с цветком.
  const gKey = (l: Line) => `${l.flowerType}|${l.grade}`;
  const gLabel = (l: Line) => gradeLabel(l.flowerType, l.grade);
  const byGrade = toRows(group(cur, gKey, gLabel, true), group(prev, gKey, gLabel, true), t.stems).sort((a, b) => {
    const [fa, ga] = a.key.split("|");
    const [fb, gb] = b.key.split("|");
    return flowerRank(fa) - flowerRank(fb) || compareGrades(fa, ga, gb);
  });

  // Сорта — по стеблям, крупные сверху.
  const vKey = (l: Line) => `${l.flowerType}|${l.variety}`;
  const vLabel = (l: Line) => l.variety;
  const byVariety = toRows(group(cur, vKey, vLabel, true), group(prev, vKey, vLabel, true), t.stems).sort(
    (a, b) => b.stems - a.stems || a.label.localeCompare(b.label, "ru")
  );

  // Менеджеры + точка на базаре отдельной строкой «для справки».
  const mKey = (l: Line) => l.manager;
  const mLabel = (l: Line) => l.manager;
  const byManager = toRows(group(cur, mKey, mLabel), group(prev, mKey, mLabel), t.stems).sort(
    (a, b) => b.stems - a.stems || a.label.localeCompare(b.label, "ru")
  );
  const pointCur = allCur.filter((l) => l.point);
  if (pointCur.length > 0) {
    const pointPrev = allPrev.filter((l) => l.point);
    const s = sum(pointCur);
    byManager.push({
      key: POINT_ROW_KEY,
      label: "Точка на базаре (перемещение)",
      stems: s.stems,
      amount: s.amount,
      orders: s.orders,
      share: 0,
      prevStems: sum(pointPrev).stems,
      aside: true,
    });
  }

  // Матрица менеджер × ростовка — только по одному цветку, иначе колонки смешаются.
  let matrix: FlowerSalesMatrix | null = null;
  if (flower) {
    const grades = Array.from(new Set(cur.map((l) => l.grade))).sort((a, b) => compareGrades(flower, a, b));
    const rowsMap = new Map<string, { cells: Record<string, number>; total: number; aside?: boolean }>();
    const add = (key: string, l: Line, aside?: boolean) => {
      const r = rowsMap.get(key) ?? { cells: {}, total: 0, aside };
      r.cells[l.grade] = (r.cells[l.grade] ?? 0) + l.stems;
      r.total += l.stems;
      rowsMap.set(key, r);
    };
    for (const l of cur) add(l.manager, l);
    const totalsCells: Record<string, number> = {};
    for (const l of cur) totalsCells[l.grade] = (totalsCells[l.grade] ?? 0) + l.stems;
    const rows = Array.from(rowsMap.entries())
      .map(([key, r]) => ({ key, label: key, ...r }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "ru"));
    if (pointCur.length > 0) {
      const r = { key: POINT_ROW_KEY, label: "Точка на базаре", cells: {} as Record<string, number>, total: 0, aside: true };
      for (const l of pointCur) {
        r.cells[l.grade] = (r.cells[l.grade] ?? 0) + l.stems;
        r.total += l.stems;
        if (!grades.includes(l.grade)) grades.push(l.grade);
      }
      grades.sort((a, b) => compareGrades(flower, a, b));
      rows.push(r);
    }
    matrix = { grades, rows, totals: totalsCells };
  }

  return { period, prevPeriod, flower, totals, prevTotals, byFlower, byGrade, byVariety, byManager, matrix };
}
