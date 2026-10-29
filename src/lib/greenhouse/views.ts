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

// --- Качество простыми словами (29.10.2026, владелец: «неудобный вид по категориям, убери шум») ------------------
// Девять категорий полосой читаются плохо. Для обзора и аналитики они сведены в три группы — что продаётся легко,
// что средне и что тяжело; полный список категорий остаётся на странице блока.

export type QualityKey = "top" | "mid" | "low";
export const QUALITY_GROUPS: { key: QualityKey; label: string; grades: string[]; color: string }[] = [
  { key: "top", label: "Высшая и 1-я", grades: ["Высшая", "Первая"], color: "#2f8a55" },
  { key: "mid", label: "2-я и 3-я", grades: ["Вторая", "Третья"], color: "#e2c14a" },
  { key: "low", label: "4-я, мини и брак", grades: ["Четвёртая", "Мини-микс", "Нераскрывшийся", "Брак", "Уценка"], color: "#d9826b" },
];
export const QUALITY_COLORS: Record<string, string> = Object.fromEntries(QUALITY_GROUPS.map((g) => [g.label, g.color]));

export interface QualitySplit {
  key: QualityKey;
  label: string;
  color: string;
  qty: number;
  pct: number;
}

export function qualityOf(grade: string): QualityKey {
  return QUALITY_GROUPS.find((g) => g.grades.includes(grade))?.key ?? "low";
}

export function qualitySplit(grades: { grade: string; qty: number }[]): QualitySplit[] {
  const total = grades.reduce((s, g) => s + g.qty, 0);
  return QUALITY_GROUPS.map((g) => {
    const qty = grades.filter((x) => g.grades.includes(x.grade)).reduce((s, x) => s + x.qty, 0);
    return { key: g.key, label: g.label, color: g.color, qty, pct: total ? r1((qty * 100) / total) : 0 };
  });
}

// --- Циклы: какой текущий -------------------------------------------------------------------------------------------

export type CyclePhase = "harvest" | "growing" | "cuttings" | "planned" | "done";
export const CYCLE_PHASE_LABELS: Record<CyclePhase, string> = {
  harvest: "идёт срезка",
  growing: "растёт",
  cuttings: "черенкование",
  planned: "запланирован",
  done: "завершён",
};

/** Фаза цикла по его блокам: что-то режется — срезка; иначе растёт; иначе черенкование; иначе завершён. */
export function cyclePhase(c: { blocks: { status: BlockStatus }[] }): CyclePhase {
  const has = (s: BlockStatus) => c.blocks.some((b) => b.status === s);
  if (has("harvest")) return "harvest";
  if (has("growing")) return "growing";
  if (has("cuttings")) return "cuttings";
  if (has("planned")) return "planned";
  return "done";
}

export interface CycleOption {
  cycle: number;
  phase: CyclePhase;
  current: boolean;
  label: string;
}

/** Пункты выбора цикла: «Цикл 11 — идёт срезка (текущий)». Текущий — тот, что сейчас режется (`defaultCycle`). */
export function cycleOptions(cycles: CycleCard[]): CycleOption[] {
  const current = defaultCycle(cycles);
  return [...cycles]
    .sort((a, b) => b.cycle - a.cycle)
    .map((c) => {
      const phase = cyclePhase(c);
      return { cycle: c.cycle, phase, current: c.cycle === current, label: `Цикл ${c.cycle} — ${CYCLE_PHASE_LABELS[phase]}${c.cycle === current ? " · текущий" : ""}` };
    });
}

/** Прошлый ЗАВЕРШЁННЫЙ цикл — с ним честно сравнивать выход. */
export function previousFinished(cycles: CycleCard[], cycle: number): CycleCard | null {
  return [...cycles].filter((c) => c.cycle < cycle && c.harvested > 0 && cyclePhase(c) === "done").sort((a, b) => b.cycle - a.cycle)[0] ?? null;
}

export function finishedCycles(cycles: CycleCard[]): CycleCard[] {
  return cycles.filter((c) => c.harvested > 0 && c.planted > 0 && cyclePhase(c) === "done").sort((a, b) => b.cycle - a.cycle);
}

/** Разница в процентных пунктах, округлённая; null — сравнивать не с чем. */
export function pointsDelta(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  return Math.round((now - before) * 10) / 10;
}

/** Выход выше 102 % — недоучёт посадки в книге (с одного черенка — один стебель), а не урожай: в рейтинги не идёт. */
export const YIELD_SANE_MAX = 102;
export function saneYield(y: number | null): number | null {
  return y !== null && y <= YIELD_SANE_MAX ? y : null;
}

// --- Рейтинги ------------------------------------------------------------------------------------------------------

export interface RankRow {
  key: string;
  label: string;
  planted: number;
  harvested: number;
  yieldPct: number | null;
  topShare: number | null;
  avgWeight: number | null;
  cycles: number;
  quality: QualitySplit[];
  /** Пометка вместо цифры: «идёт срезка», «нет данных о посадке». */
  note: string;
}

const mergeGrades = (into: Map<string, number>, grades: { grade: string; qty: number }[]) => {
  for (const g of grades) into.set(g.grade, (into.get(g.grade) ?? 0) + g.qty);
};
const gradesOf = (m: Map<string, number>) => HARVEST_GRADES.map((g) => ({ grade: g, qty: m.get(g) ?? 0 })).filter((g) => g.qty > 0);

/**
 * Блоки по выбранным циклам: выход = всё срезанное / всё посаженное, качество — по сумме срезки, вес — взвешенно.
 * Циклы, где блок ещё режется или растёт, в выход не идут (выход неполный).
 */
export function rankBlocks(cycles: CycleCard[]): RankRow[] {
  const acc = new Map<string, { planted: number; harvested: number; wg: number; wq: number; grades: Map<string, number>; n: number; live: string }>();
  for (const c of cycles) {
    for (const b of c.blocks) {
      let a = acc.get(b.block);
      if (!a) {
        a = { planted: 0, harvested: 0, wg: 0, wq: 0, grades: new Map(), n: 0, live: "" };
        acc.set(b.block, a);
      }
      mergeGrades(a.grades, b.grades);
      if (b.avgWeight !== null && b.harvested > 0) {
        a.wg += b.avgWeight * b.harvested;
        a.wq += b.harvested;
      }
      if (b.status === "done" && b.planted > 0 && b.harvested > 0) {
        a.planted += b.planted;
        a.harvested += b.harvested;
        a.n += 1;
      } else if (b.status === "harvest") a.live = "идёт срезка";
      else if (b.status === "growing") a.live = a.live || "растёт";
    }
  }
  return Array.from(acc.entries())
    .map(([block, a]) => {
      const grades = gradesOf(a.grades);
      const quality = qualitySplit(grades);
      const y = a.planted > 0 ? r1((a.harvested * 100) / a.planted) : null;
      return {
        key: block,
        label: /^\d+$/.test(block) ? `Блок ${block}` : block,
        planted: a.planted,
        harvested: a.harvested,
        yieldPct: saneYield(y),
        topShare: grades.length ? quality[0].pct : null,
        avgWeight: a.wq > 0 ? r1(a.wg / a.wq) : null,
        cycles: a.n,
        quality,
        note: y !== null && y > YIELD_SANE_MAX ? "посадка записана не полностью" : a.n === 0 ? a.live || "нет срезки" : "",
      };
    })
    .filter((r) => r.cycles > 0 || r.note);
}

/** Сорта по выбранным циклам (по сортам внутри блоков). Мелочь (меньше `minPlanted` посаженных) не ранжируется. */
export function rankVarieties(rows: CycleRow[], minPlanted = 3000): RankRow[] {
  const acc = new Map<string, { planted: number; harvested: number; wg: number; wq: number; grades: Map<string, number>; cycles: Set<number> }>();
  for (const c of rows) {
    for (const b of c.blocks) {
      for (const v of b.varieties) {
        let a = acc.get(v.variety);
        if (!a) {
          a = { planted: 0, harvested: 0, wg: 0, wq: 0, grades: new Map(), cycles: new Set() };
          acc.set(v.variety, a);
        }
        a.cycles.add(c.cycle);
        mergeGrades(
          a.grades,
          Object.entries(v.byGrade).map(([grade, qty]) => ({ grade, qty })),
        );
        if (v.avgWeight !== null && v.harvested > 0) {
          a.wg += v.avgWeight * v.harvested;
          a.wq += v.harvested;
        }
        // Выход — только там, где сорт и посажен, и срезан, и блок уже отрезан.
        if (b.status === "done" && v.planted > 0) {
          a.planted += v.planted;
          a.harvested += v.harvested;
        }
      }
    }
  }
  return Array.from(acc.entries())
    .map(([variety, a]) => {
      const grades = gradesOf(a.grades);
      const quality = qualitySplit(grades);
      const harvestedAll = grades.reduce((s, g) => s + g.qty, 0);
      const y = a.planted >= minPlanted ? r1((a.harvested * 100) / a.planted) : null;
      return {
        key: variety,
        label: variety,
        planted: a.planted,
        harvested: harvestedAll,
        yieldPct: saneYield(y),
        topShare: harvestedAll ? quality[0].pct : null,
        avgWeight: a.wq > 0 ? r1(a.wg / a.wq) : null,
        cycles: a.cycles.size,
        quality,
        note: a.planted < minPlanted ? "посадка не записана" : y !== null && y > YIELD_SANE_MAX ? "посадка записана не полностью" : "",
      };
    })
    .filter((r) => r.harvested > 0);
}

// --- Выводы словами --------------------------------------------------------------------------------------------------

const fmtN = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtP = (n: number) => `${Math.round(n)} %`;
const fmtD = (n: number) => Math.abs(n).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

/** Две-три фразы о блоках: лучший, отстающий, разброс. */
export function blockInsights(rows: RankRow[]): string[] {
  const ranked = rows.filter((r) => r.yieldPct !== null).sort((a, b) => b.yieldPct! - a.yieldPct!);
  if (ranked.length < 2) return [];
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const out = [`Лучший выход — ${best.label}: ${fmtP(best.yieldPct!)}, слабее всех — ${worst.label}: ${fmtP(worst.yieldPct!)}.`];
  const byTop = rows.filter((r) => r.topShare !== null && r.harvested > 0).sort((a, b) => b.topShare! - a.topShare!);
  if (byTop.length >= 2) out.push(`Больше всего высшей и 1-й — ${byTop[0].label} (${fmtP(byTop[0].topShare!)} срезки), меньше всего — ${byTop[byTop.length - 1].label} (${fmtP(byTop[byTop.length - 1].topShare!)}).`);
  return out;
}

export function varietyInsights(rows: RankRow[]): string[] {
  const out: string[] = [];
  const big = [...rows].sort((a, b) => b.harvested - a.harvested);
  if (big.length) {
    const total = big.reduce((s, r) => s + r.harvested, 0);
    out.push(`Главный сорт — ${big[0].label}: ${fmtP((big[0].harvested * 100) / total)} всей срезки.`);
  }
  const top = rows.filter((r) => r.harvested >= 10000 && r.topShare !== null).sort((a, b) => b.topShare! - a.topShare!);
  if (top.length >= 2) out.push(`Лучшее качество у ${top[0].label} — ${fmtP(top[0].topShare!)} высшей и 1-й; хуже всех ${top[top.length - 1].label} — ${fmtP(top[top.length - 1].topShare!)}.`);
  const y = rows.filter((r) => r.yieldPct !== null).sort((a, b) => b.yieldPct! - a.yieldPct!);
  if (y.length >= 2) out.push(`Выход лучше всего у ${y[0].label} (${fmtP(y[0].yieldPct!)}), хуже — у ${y[y.length - 1].label} (${fmtP(y[y.length - 1].yieldPct!)}).`);
  return out;
}

/** Тренд по завершённым циклам: последний против предпоследнего и против среднего. */
export function cycleInsights(finished: CycleCard[]): string[] {
  const list = [...finished].sort((a, b) => a.cycle - b.cycle);
  if (list.length < 2) return [];
  const last = list[list.length - 1];
  const prev = list[list.length - 2];
  const out: string[] = [];
  const dy = pointsDelta(saneYield(last.yieldPct), saneYield(prev.yieldPct));
  if (dy !== null) out.push(`Цикл ${last.cycle}: выход ${fmtP(last.yieldPct!)} — ${dy === 0 ? "как" : dy > 0 ? `на ${fmtD(dy)} п. лучше, чем` : `на ${fmtD(dy)} п. хуже, чем`} в цикле ${prev.cycle}.`);
  const dt = pointsDelta(last.topShare, prev.topShare);
  if (dt !== null) out.push(`Высшей и 1-й — ${fmtP(last.topShare!)} срезки (${dt >= 0 ? "+" : "−"}${fmtD(dt)} п. к циклу ${prev.cycle}).`);
  const best = [...list].filter((c) => saneYield(c.yieldPct) !== null).sort((a, b) => b.yieldPct! - a.yieldPct!)[0];
  if (best && best.cycle !== last.cycle) out.push(`Лучший выход был в цикле ${best.cycle} — ${fmtP(best.yieldPct!)}.`);
  return out;
}

export function harvestInsight(buckets: HarvestBucket[], by: "week" | "month"): string | null {
  if (buckets.length < 2) return null;
  const last = buckets[buckets.length - 1];
  const prev = buckets[buckets.length - 2];
  if (!prev.total) return null;
  const d = Math.round(((last.total - prev.total) * 100) / prev.total);
  const [lastW, prevW] = by === "month" ? ["последний месяц", "предыдущий"] : ["последнюю неделю", "предыдущую"];
  return `За ${lastW} срезали ${fmtN(last.total)} шт. — ${d === 0 ? "столько же, сколько" : d > 0 ? `на ${d} % больше, чем` : `на ${Math.abs(d)} % меньше, чем`} за ${prevW}.`;
}
