import { shiftDay } from "../payroll/work";
import { CUTTING_KINDS, TOP_GRADES, WASTE_KINDS, plausibleWeight, type GhCutting, type GhHarvest, type GhWaste } from "./production";

/**
 * Панель руководителя «Теплицы» (30.10.2026, владелец прислал ТЗ «цифровой системы учёта тепличного производства»:
 * главный экран «понять за 15 секунд», потери и товарность, план и прогноз, отчёты). Здесь — чистые расчёты из того,
 * что уже вносится: срезка по категориям, брак на блоках, черенкование. Новых полей ввода нет: товарность и брак при
 * срезке следуют из категории, которую и так ставят. Проверка — `scripts/check-greenhouse.ts` («Панель»).
 */

// --- Товарность -----------------------------------------------------------------------------------------------------

/**
 * Категория срезки → класс продукции. Товарные — то, что продаётся по прайсу (высшая … четвёртая и мини-микс),
 * некондиция — нераскрывшийся и уценка (продаётся, но со скидкой), брак — списано при срезке.
 */
export type SaleClass = "saleable" | "substandard" | "reject";
export const SALEABLE_GRADES = ["Высшая", "Первая", "Вторая", "Третья", "Четвёртая", "Мини-микс"];
export const SUBSTANDARD_GRADES = ["Нераскрывшийся", "Уценка"];
export const REJECT_GRADES = ["Брак"];
export const SALE_CLASS_LABELS: Record<SaleClass, string> = { saleable: "Товарные", substandard: "Некондиция", reject: "Брак при срезке" };

export function saleClass(grade: string): SaleClass {
  if (REJECT_GRADES.includes(grade)) return "reject";
  if (SUBSTANDARD_GRADES.includes(grade)) return "substandard";
  return "saleable";
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a * 1000) / b) / 10 : null);

export interface HarvestTotals {
  qty: number;
  saleable: number;
  substandard: number;
  reject: number;
  saleablePct: number | null;
  rejectPct: number | null;
  topPct: number | null;
  avgWeight: number | null;
  /** Дней, в которые что-то срезали. */
  days: number;
  /** Средняя срезка за день срезки. */
  perDay: number | null;
  blocks: number;
}

export function harvestTotals(rows: GhHarvest[], from: string, to: string): HarvestTotals {
  let qty = 0;
  let saleable = 0;
  let substandard = 0;
  let reject = 0;
  let top = 0;
  let kg = 0;
  let kgQty = 0;
  const days = new Set<string>();
  const blocks = new Set<string>();
  for (const h of rows) {
    if (h.date < from || h.date > to || h.qty <= 0) continue;
    qty += h.qty;
    const c = saleClass(h.grade);
    if (c === "saleable") saleable += h.qty;
    else if (c === "substandard") substandard += h.qty;
    else reject += h.qty;
    if (TOP_GRADES.includes(h.grade)) top += h.qty;
    if (h.weightKg > 0 && plausibleWeight(h.qty, h.weightKg)) {
      kg += h.weightKg;
      kgQty += h.qty;
    }
    days.add(h.date);
    blocks.add(h.block);
  }
  return {
    qty,
    saleable,
    substandard,
    reject,
    saleablePct: pctOf(saleable, qty),
    rejectPct: pctOf(reject, qty),
    topPct: pctOf(top, qty),
    avgWeight: kgQty ? Math.round((kg * 1000) / kgQty) : null,
    days: days.size,
    perDay: days.size ? Math.round(qty / days.size) : null,
    blocks: blocks.size,
  };
}

/** Тот же отрезок длины перед этим: 1–30 октября → 1–30 сентября по дням (2–31 августа…). */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to) + 1;
  return { from: shiftDay(from, -len), to: shiftDay(from, -1) };
}

// --- Потери ---------------------------------------------------------------------------------------------------------

const CULL_KINDS = ["dept_cull", "nursery_cull", "cull"];

export interface LossReason {
  code: string;
  label: string;
  /** Где потеряли: на блоке (журнал брака), при срезке (категория «Брак»), при посадке (черенкование). */
  stage: "block" | "harvest" | "planting";
  qty: number;
  share: number;
}

export interface LossRow {
  key: string;
  label: string;
  /** Срезано за период (вместе с браком при срезке). */
  harvested: number;
  /** Брак на блоке (повилика, клещ…) + брак при срезке. */
  lost: number;
  /** Потери от всего, что дал блок: брак / (срезано + брак на блоке). */
  pct: number | null;
}

export interface LossReport {
  from: string;
  to: string;
  harvested: number;
  /** Брак на блоках из журнала брака. */
  onBlocks: number;
  /** Категория «Брак» при срезке. */
  atHarvest: number;
  /** Нераскрывшийся и уценка — продаётся, но хуже. */
  substandard: number;
  lost: number;
  /** Потери на блоках и при срезке от всего, что дали блоки. */
  lossPct: number | null;
  /** Отход при посадке: брак отделения, рассадника и выбраковка — от пришедших черенков. */
  culls: number;
  arrived: number;
  cullPct: number | null;
  reasons: LossReason[];
  byBlock: LossRow[];
  byVariety: LossRow[];
}

export function lossReport(data: { harvest: GhHarvest[]; waste: GhWaste[]; cuttings: GhCutting[] }, from: string, to: string): LossReport {
  const inRange = (d: string) => d >= from && d <= to;
  const reasons = new Map<string, LossReason>();
  const add = (code: string, label: string, stage: LossReason["stage"], qty: number) => {
    const key = `${stage}:${code}`;
    const r = reasons.get(key) ?? { code, label, stage, qty: 0, share: 0 };
    r.qty += qty;
    reasons.set(key, r);
  };
  const byBlock = new Map<string, { harvested: number; lost: number }>();
  const byVariety = new Map<string, { harvested: number; lost: number }>();
  const bump = (map: Map<string, { harvested: number; lost: number }>, key: string, harvested: number, lost: number) => {
    const x = map.get(key) ?? { harvested: 0, lost: 0 };
    x.harvested += harvested;
    x.lost += lost;
    map.set(key, x);
  };

  let harvested = 0;
  let atHarvest = 0;
  let substandard = 0;
  for (const h of data.harvest) {
    if (!inRange(h.date) || h.qty <= 0) continue;
    harvested += h.qty;
    const c = saleClass(h.grade);
    const lost = c === "reject" ? h.qty : 0;
    if (c === "reject") {
      atHarvest += h.qty;
      add("harvest_reject", "Брак при срезке", "harvest", h.qty);
    }
    if (c === "substandard") substandard += h.qty;
    bump(byBlock, h.block, h.qty, lost);
    if (h.variety) bump(byVariety, h.variety, h.qty, lost);
  }

  let onBlocks = 0;
  for (const w of data.waste) {
    if (!inRange(w.date) || w.qty <= 0) continue;
    onBlocks += w.qty;
    add(w.kind, WASTE_KINDS.find((k) => k.code === w.kind)?.label ?? w.kind, "block", w.qty);
    bump(byBlock, w.block, 0, w.qty);
    if (w.variety) bump(byVariety, w.variety, 0, w.qty);
  }

  let culls = 0;
  let actual = 0;
  let invoice = 0;
  for (const c of data.cuttings) {
    if (!inRange(c.date) || c.qty <= 0) continue;
    if (CULL_KINDS.includes(c.kind)) {
      culls += c.qty;
      add(c.kind, CUTTING_KINDS.find((k) => k.code === c.kind)?.label ?? c.kind, "planting", c.qty);
    } else if (c.kind === "actual" || c.kind === "from_stock") actual += c.qty;
    else if (c.kind === "invoice") invoice += c.qty;
  }
  const arrived = actual > 0 ? actual : invoice;

  // Доля — внутри своего этапа: потери на блоках и при срезке — от их суммы, отход при посадке — от своей.
  const stageTotal = (planting: boolean) => Array.from(reasons.values()).reduce((s, r) => ((r.stage === "planting") === planting ? s + r.qty : s), 0);
  const growTotal = stageTotal(false);
  const plantTotal = stageTotal(true);
  const list = Array.from(reasons.values())
    .map((r) => {
      const base = r.stage === "planting" ? plantTotal : growTotal;
      return { ...r, share: base ? Math.round((r.qty * 1000) / base) / 10 : 0 };
    })
    // Сначала потери на блоках и при срезке, отход при посадке — после них.
    .sort((a, b) => Number(a.stage === "planting") - Number(b.stage === "planting") || b.qty - a.qty);
  // Строка блока или сорта: «срезано» — со срезки (с браком при срезке), «потеряно» — брак при срезке + брак на
  // блоке, процент — от всего, что дал блок: срезано + брак на блоке.
  const wasteByBlock = new Map<string, number>();
  const wasteByVariety = new Map<string, number>();
  for (const w of data.waste) {
    if (!inRange(w.date) || w.qty <= 0) continue;
    wasteByBlock.set(w.block, (wasteByBlock.get(w.block) ?? 0) + w.qty);
    if (w.variety) wasteByVariety.set(w.variety, (wasteByVariety.get(w.variety) ?? 0) + w.qty);
  }
  const rows = (map: Map<string, { harvested: number; lost: number }>, waste: Map<string, number>, label: (k: string) => string): LossRow[] =>
    Array.from(map.entries())
      .filter(([, x]) => x.harvested + x.lost > 0)
      .map(([key, x]) => ({ key, label: label(key), harvested: x.harvested, lost: x.lost, pct: pctOf(x.lost, x.harvested + (waste.get(key) ?? 0)) }))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.lost - a.lost);

  const lost = onBlocks + atHarvest;
  return {
    from,
    to,
    harvested,
    onBlocks,
    atHarvest,
    substandard,
    lost,
    lossPct: pctOf(lost, harvested + onBlocks),
    culls,
    arrived,
    cullPct: pctOf(culls, arrived),
    reasons: list,
    byBlock: rows(byBlock, wasteByBlock, blockLabel),
    byVariety: rows(byVariety, wasteByVariety, (k) => k),
  };
}

export function blockLabel(b: string): string {
  return b === "—" ? "Без блока" : /^\d+$/.test(b) ? `Блок ${b}` : b;
}

/** Потери по месяцам — динамика за последние `months` месяцев до `to` включительно. */
export function lossByMonth(data: { harvest: GhHarvest[]; waste: GhWaste[] }, to: string, months = 12): { month: string; harvested: number; lost: number; pct: number | null }[] {
  const keys: string[] = [];
  let [y, m] = to.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < months; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const map = new Map(keys.map((k) => [k, { harvested: 0, lost: 0, waste: 0 }]));
  for (const h of data.harvest) {
    const x = map.get(h.date.slice(0, 7));
    if (!x || h.qty <= 0) continue;
    x.harvested += h.qty;
    if (saleClass(h.grade) === "reject") x.lost += h.qty;
  }
  for (const w of data.waste) {
    const x = map.get(w.date.slice(0, 7));
    if (!x || w.qty <= 0) continue;
    x.lost += w.qty;
    x.waste += w.qty;
  }
  return keys.map((k) => {
    const x = map.get(k)!;
    return { month: k, harvested: x.harvested, lost: x.lost, pct: pctOf(x.lost, x.harvested + x.waste) };
  });
}
