import { compareBlocks, shiftDay } from "../payroll/work";
import { BLOCK_STATUS_LABELS, HARVEST_GRADES, TOP_GRADES, WASTE_KINDS, blockSource, type BlockStatus, type BlockSummary, type CycleRow, type GhHarvest, type GhWaste } from "./production";

/**
 * Что уходит в браузер со страниц «Теплицы»: сводки `production.ts`, ужатые до того, что рисуется. Полные сводки по
 * всем циклам — сотни сортов по блокам; таскать их в каждую страницу незачем. Чистые функции, без таблицы.
 */

/** Цвет категории — одна шкала на весь раздел: от тёмно-зелёной высшей к серому браку. */
export const GRADE_COLORS: Record<string, string> = {
  Высшая: "#1f6b3a",
  Первая: "#3f9a5c",
  Вторая: "#8cc56f",
  Третья: "#e2c14a",
  Четвёртая: "#e39a3b",
  "Мини-микс": "#7aa6d6",
  Нераскрывшийся: "#b48ac9",
  Брак: "#c9584e",
  Уценка: "#a8a39a",
};
export const GRADE_SHORT: Record<string, string> = {
  Высшая: "Высш.",
  Первая: "1",
  Вторая: "2",
  Третья: "3",
  Четвёртая: "4",
  "Мини-микс": "Мини",
  Нераскрывшийся: "Нераскр.",
  Брак: "Брак",
  Уценка: "Уценка",
};

export const STATUS_TONE: Record<BlockStatus, string> = {
  harvest: "bg-[#e6f4ea] text-[#1f6b3a] border-[#1f6b3a]/20",
  growing: "bg-[#eef5fb] text-[#2a5f96] border-[#2a5f96]/20",
  cuttings: "bg-[#fdf6e7] text-[#8a5a00] border-[#8a5a00]/20",
  planned: "bg-surface-sunk text-ink-secondary border-line-hairline",
  done: "bg-surface-sunk text-ink-muted border-line-hairline",
  noharvest: "bg-[#fbeeee] text-[#a12b2b] border-[#a12b2b]/20",
  empty: "bg-surface-sunk text-ink-muted border-line-hairline",
};

export interface BlockCard {
  cycle: number;
  block: string;
  status: BlockStatus;
  statusLabel: string;
  cuttingsAt: string;
  plantedAt: string;
  expectedHarvestAt: string;
  expectedIsEstimate: boolean;
  firstHarvestAt: string;
  lastHarvestAt: string;
  planted: number;
  harvested: number;
  yieldPct: number | null;
  topShare: number | null;
  avgWeight: number | null;
  wasteTotal: number;
  /** Отход при посадке, % от пришедшего (брак отделения, рассадника, тех брак, выбраковка). */
  plantingLossPct: number | null;
  /** Срезано по категориям, шт. — для полоски. */
  grades: { grade: string; qty: number }[];
  varieties: { name: string; planted: number; harvested: number }[];
  /** Дней до ожидаемой срезки (минус — уже прошла) у тех, кто ещё не режется. */
  daysToHarvest: number | null;
  /** Последняя срезка — дней назад. */
  daysSinceHarvest: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const days = (a: string, b: string) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null);

export function blockCard(s: BlockSummary, today: string): BlockCard {
  const source = blockSource(s);
  const loss = s.totals.deptCull + s.totals.nurseryCull + s.totals.techCull + s.totals.cull;
  return {
    cycle: s.cycle,
    block: s.block,
    status: s.status,
    statusLabel: BLOCK_STATUS_LABELS[s.status],
    cuttingsAt: s.dates.cuttingsAt,
    plantedAt: s.dates.plantedAt,
    expectedHarvestAt: s.expectedHarvestAt,
    expectedIsEstimate: s.expectedIsEstimate,
    firstHarvestAt: s.firstHarvestAt,
    lastHarvestAt: s.lastHarvestAt,
    planted: s.totals.planted,
    harvested: s.totals.harvested,
    yieldPct: s.totals.yieldPct,
    topShare: s.topShare,
    avgWeight: s.totals.avgWeight,
    wasteTotal: s.totals.wasteTotal,
    plantingLossPct: source > 0 ? r1((loss * 100) / source) : null,
    grades: HARVEST_GRADES.map((g) => ({ grade: g, qty: s.totals.byGrade[g] ?? 0 })).filter((g) => g.qty > 0),
    varieties: s.varieties.slice(0, 40).map((v) => ({ name: v.variety, planted: v.planted, harvested: v.harvested })),
    daysToHarvest: !s.firstHarvestAt && s.expectedHarvestAt ? days(today, s.expectedHarvestAt) : null,
    daysSinceHarvest: s.lastHarvestAt ? days(s.lastHarvestAt, today) : null,
  };
}

export interface CycleCard {
  cycle: number;
  blocks: BlockCard[];
  planted: number;
  harvested: number;
  yieldPct: number | null;
  topShare: number | null;
  avgWeight: number | null;
  wasteTotal: number;
  cullPct: number | null;
  firstCuttingsAt: string;
  lastHarvestAt: string;
  /** Сколько блоков в каком состоянии. */
  statusCounts: Partial<Record<BlockStatus, number>>;
  grades: { grade: string; qty: number }[];
}

export function cycleCard(c: CycleRow, today: string): CycleCard {
  const blocks = c.blocks.map((b) => blockCard(b, today)).sort((a, b) => compareBlocks(a.block, b.block));
  const statusCounts: Partial<Record<BlockStatus, number>> = {};
  const grades = new Map<string, number>();
  for (const b of blocks) {
    statusCounts[b.status] = (statusCounts[b.status] ?? 0) + 1;
    for (const g of b.grades) grades.set(g.grade, (grades.get(g.grade) ?? 0) + g.qty);
  }
  return {
    cycle: c.cycle,
    blocks,
    planted: c.planted,
    harvested: c.harvested,
    yieldPct: c.yieldPct,
    topShare: c.topShare,
    avgWeight: c.avgWeight,
    wasteTotal: c.wasteTotal,
    cullPct: c.cullPct,
    firstCuttingsAt: c.firstCuttingsAt,
    lastHarvestAt: c.lastHarvestAt,
    statusCounts,
    grades: HARVEST_GRADES.map((g) => ({ grade: g, qty: grades.get(g) ?? 0 })).filter((g) => g.qty > 0),
  };
}

/**
 * Какой цикл открыть по умолчанию: тот, что сейчас режется (самый большой номер с блоком «срезка»), иначе самый
 * большой со срезкой вообще — «как прошёл последний», иначе самый большой.
 */
export function defaultCycle(cycles: { cycle: number; blocks: { status: BlockStatus; harvested: number }[] }[]): number {
  const cutting = cycles.filter((c) => c.blocks.some((b) => b.status === "harvest")).map((c) => c.cycle);
  if (cutting.length) return Math.max(...cutting);
  const harvested = cycles.filter((c) => c.blocks.some((b) => b.harvested > 0)).map((c) => c.cycle);
  if (harvested.length) return Math.max(...harvested);
  return cycles.length ? Math.max(...cycles.map((c) => c.cycle)) : 0;
}

/** «Сейчас в теплице»: по каждому блоку — последний цикл, в котором блок занят (не завершён), иначе последний. */
export function nowByBlock(cycles: CycleCard[]): BlockCard[] {
  const out = new Map<string, BlockCard>();
  const sorted = [...cycles].sort((a, b) => b.cycle - a.cycle);
  for (const c of sorted) {
    for (const b of c.blocks) {
      const cur = out.get(b.block);
      if (!cur) {
        out.set(b.block, b);
        continue;
      }
      // Новый цикл ещё только запланирован, а старый режется — показываем тот, что режется.
      if ((cur.status === "planned" || cur.status === "empty") && b.status !== "done" && b.status !== "empty") out.set(b.block, b);
    }
  }
  return Array.from(out.values()).sort((a, b) => compareBlocks(a.block, b.block));
}

// --- Блоки × циклы ------------------------------------------------------------------

export type HeatMetric = "yield" | "harvested" | "top" | "weight" | "waste" | "loss";
export const HEAT_METRICS: { key: HeatMetric; label: string; unit: string; better: "high" | "low" }[] = [
  { key: "yield", label: "Выход, % от посаженного", unit: "%", better: "high" },
  { key: "harvested", label: "Срезано, шт.", unit: "шт.", better: "high" },
  { key: "top", label: "Высшая + первая, %", unit: "%", better: "high" },
  { key: "weight", label: "Средний вес стебля, г", unit: "г", better: "high" },
  { key: "loss", label: "Отход при посадке, %", unit: "%", better: "low" },
  { key: "waste", label: "Брак на блоке, шт.", unit: "шт.", better: "low" },
];

export function heatValue(b: BlockCard, m: HeatMetric): number | null {
  switch (m) {
    case "yield":
      return b.harvested > 0 && b.status === "done" ? b.yieldPct : b.harvested > 0 ? b.yieldPct : null;
    case "harvested":
      return b.harvested > 0 ? b.harvested : null;
    case "top":
      return b.topShare;
    case "weight":
      return b.avgWeight;
    case "loss":
      return b.plantingLossPct;
    case "waste":
      return b.wasteTotal > 0 ? b.wasteTotal : b.planted > 0 ? 0 : null;
  }
}

// --- Срезка по времени ------------------------------------------------------------

/** Понедельник недели даты. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return shiftDay(date, -dow);
}

export interface HarvestBucket {
  key: string;
  label: string;
  total: number;
  byGrade: Record<string, number>;
}

/** Срезка по неделям или месяцам со стопкой категорий. */
export function harvestBuckets(rows: GhHarvest[], from: string, to: string, by: "week" | "month"): HarvestBucket[] {
  const map = new Map<string, HarvestBucket>();
  for (const h of rows) {
    if (h.date < from || h.date > to) continue;
    const key = by === "week" ? weekStart(h.date) : h.date.slice(0, 7);
    let b = map.get(key);
    if (!b) {
      b = { key, label: key, total: 0, byGrade: {} };
      map.set(key, b);
    }
    b.total += h.qty;
    b.byGrade[h.grade] = (b.byGrade[h.grade] ?? 0) + h.qty;
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** Брак по причинам и циклам — таблица «цикл × причина». */
export function wasteByCycle(rows: GhWaste[]): { cycle: number; total: number; byKind: Record<string, number> }[] {
  const map = new Map<number, { cycle: number; total: number; byKind: Record<string, number> }>();
  for (const w of rows) {
    let x = map.get(w.cycle);
    if (!x) {
      x = { cycle: w.cycle, total: 0, byKind: {} };
      map.set(w.cycle, x);
    }
    x.total += w.qty;
    x.byKind[w.kind] = (x.byKind[w.kind] ?? 0) + w.qty;
  }
  return Array.from(map.values()).sort((a, b) => b.cycle - a.cycle);
}

export const WASTE_KIND_ORDER = WASTE_KINDS.map((k) => k.code as string);

export function topShareOf(byGrade: Record<string, number>): number | null {
  const total = Object.values(byGrade).reduce((s, n) => s + n, 0);
  if (!total) return null;
  return r1((TOP_GRADES.reduce((s, g) => s + (byGrade[g] ?? 0), 0) * 100) / total);
}
