import { shiftDay } from "../payroll/work";
import { weeksOfMonth } from "../constants";
import { compareBlocks } from "../payroll/work";
import { blockLabel, daysBetween, harvestTotals, lossReport, previousRange, saleClass, type HarvestTotals, type LossReport } from "./insights";
import { planFact, type Forecast, type ForecastAccuracy, type PlanFact, type PlanRow } from "./forecast";
import { QUALITY_GROUPS, qualityOf } from "./views";
import { TOP_GRADES, type CycleRow, type GhCutting, type GhCycle, type GhHarvest, type GhWaste } from "./production";

/**
 * Панель руководителя на «Обзоре» теплицы (30.10.2026, ТЗ владельца: «главная панель должна давать возможность за
 * 10–15 секунд понять, что происходит на производстве»). Чистые функции: всё из журналов, которые и так ведутся.
 *
 * Сравнения — одинаковыми отрезками: 7 дней против 7 дней перед ними, 30 против 30. «Сегодня» часто ещё не внесено,
 * поэтому рядом всегда стоит последний день, за который срезка есть.
 */

export interface GhInputData {
  cycles: GhCycle[];
  harvest: GhHarvest[];
  cuttings: GhCutting[];
  waste: GhWaste[];
}

export interface InField {
  /** Блоков, которые растут или режутся. */
  blocks: number;
  planted: number;
  harvested: number;
  /** Ещё на блоках ≈ посажено − срезано − брак на блоке (не меньше нуля по каждому блоку). */
  onBeds: number;
}

export interface DailyPoint {
  date: string;
  label: string;
  total: number;
  [quality: string]: number | string;
}

export interface Dashboard {
  today: string;
  /** Последний день, за который внесена срезка. */
  lastDay: string;
  todayTotals: HarvestTotals;
  lastDayTotals: HarvestTotals;
  week: HarvestTotals;
  prevWeek: HarvestTotals;
  month: HarvestTotals;
  last30: HarvestTotals;
  prev30: HarvestTotals;
  loss30: LossReport;
  lossPrev30: LossReport;
  plan: PlanFact;
  inField: InField;
  daily: DailyPoint[];
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;

export function inFieldOf(rows: CycleRow[]): InField {
  let blocks = 0;
  let planted = 0;
  let harvested = 0;
  let onBeds = 0;
  for (const c of rows)
    for (const b of c.blocks) {
      if (b.status !== "growing" && b.status !== "harvest") continue;
      if (b.totals.planted <= 0) continue;
      blocks += 1;
      planted += b.totals.planted;
      harvested += b.totals.harvested;
      onBeds += Math.max(0, b.totals.planted - b.totals.harvested - b.totals.wasteTotal);
    }
  return { blocks, planted, harvested, onBeds };
}

/** Срезка по дням за `days` дней до `to` — столбики тремя группами качества (пустые дни — нулём). */
export function dailyQuality(harvest: GhHarvest[], to: string, days = 30): DailyPoint[] {
  const from = shiftDay(to, -(days - 1));
  const map = new Map<string, DailyPoint>();
  for (let i = 0; i < days; i++) {
    const d = shiftDay(from, i);
    const p: DailyPoint = { date: d, label: dayLabel(d), total: 0 };
    for (const g of QUALITY_GROUPS) p[g.label] = 0;
    map.set(d, p);
  }
  for (const h of harvest) {
    const p = map.get(h.date);
    if (!p || h.qty <= 0) continue;
    const g = QUALITY_GROUPS.find((x) => x.key === qualityOf(h.grade))!;
    p[g.label] = (p[g.label] as number) + h.qty;
    p.total += h.qty;
  }
  return Array.from(map.values());
}

export function buildDashboard(data: GhInputData, rows: CycleRow[], plan: PlanRow[], today: string): Dashboard {
  const lastDay = data.harvest.reduce((m, h) => (h.qty > 0 && h.date <= today && h.date > m ? h.date : m), "");
  const weekFrom = shiftDay(today, -6);
  const prevW = previousRange(weekFrom, today);
  const from30 = shiftDay(today, -29);
  const prev30 = previousRange(from30, today);
  const month = today.slice(0, 7);
  return {
    today,
    lastDay,
    todayTotals: harvestTotals(data.harvest, today, today),
    lastDayTotals: harvestTotals(data.harvest, lastDay || today, lastDay || today),
    week: harvestTotals(data.harvest, weekFrom, today),
    prevWeek: harvestTotals(data.harvest, prevW.from, prevW.to),
    month: harvestTotals(data.harvest, `${month}-01`, today),
    last30: harvestTotals(data.harvest, from30, today),
    prev30: harvestTotals(data.harvest, prev30.from, prev30.to),
    loss30: lossReport(data, from30, today),
    lossPrev30: lossReport(data, prev30.from, prev30.to),
    plan: planFact(plan, data.harvest, month, today),
    inField: inFieldOf(rows),
    daily: dailyQuality(data.harvest, today, 30),
  };
}

/** Изменение в процентах: 120 против 100 → +20. */
export function changePct(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) * 100) / before);
}

/** Изменение в пунктах: 41,3 % против 38,0 % → +3,3. */
export function changePoints(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  return Math.round((now - before) * 10) / 10;
}

// --- Требует внимания ---------------------------------------------------------------------------------------------

export interface GhAlert {
  level: "bad" | "warn" | "info";
  text: string;
  /** Где посмотреть: блок, записи, потери. */
  href?: { path: string; params?: Record<string, string> };
}

const MAX_ALERTS = 6;

/**
 * Что требует внимания руководителя — только то, что видно в данных, без порогов «с потолка»: сравнение со своей же
 * теплицей (неделя против восьми недель до неё, блок против своего обычного), не больше шести строк, сначала худшее.
 */
export function greenhouseAlerts(data: GhInputData, rows: CycleRow[], dash: Dashboard, forecast: Forecast | null): GhAlert[] {
  const out: GhAlert[] = [];
  const today = dash.today;

  // 1. Отставание от плана агронома.
  const p = dash.plan;
  if (p.hasPlan && p.planToDate > 0 && p.pacePct !== null && p.pacePct < 90) {
    out.push({
      level: p.pacePct < 75 ? "bad" : "warn",
      text: `Срезка отстаёт от плана: к сегодня ${p.fact.toLocaleString("ru-RU")} из ${p.planToDate.toLocaleString("ru-RU")} (${p.pacePct} %).`,
      href: { path: "/greenhouse/analytics", params: { view: "plan" } },
    });
  }

  // 2. Срезка не внесена: блоки режутся, а за последние два дня записей нет.
  const harvesting = rows.flatMap((c) => c.blocks.filter((b) => b.status === "harvest").map((b) => ({ ...b, cycle: c.cycle })));
  if (harvesting.length && dash.lastDay && daysBetween(dash.lastDay, today) >= 2) {
    out.push({
      level: "warn",
      text: `Последняя срезка внесена ${dayLabel(dash.lastDay)} — ${daysBetween(dash.lastDay, today)} дн. назад, а блоки ещё режутся. Не забыли внести?`,
      href: { path: "/greenhouse/day" },
    });
  } else {
    // 3. Режущийся блок замолчал, когда соседние режутся: дорезан или не внесли.
    const quiet = harvesting.filter((b) => b.lastHarvestAt && daysBetween(b.lastHarvestAt, today) >= 4 && daysBetween(b.lastHarvestAt, today) <= 13).sort((a, b) => compareBlocks(a.block, b.block));
    if (quiet.length)
      out.push({
        level: "info",
        text: `${quiet.length === 1 ? "Блок" : "Блоки"} ${quiet.map((b) => `${b.block} (ц. ${b.cycle})`).join(", ")}: срезки не было ${quiet.length === 1 ? daysBetween(quiet[0].lastHarvestAt, today) + " дн." : "4+ дн."} — дорезан или не внесли?`,
      });
  }

  // 4. Посажен, срок срезки прошёл, а срезки нет.
  // Давние «срезки нет» (год назад книгу просто не дописали) — не повод тревожить сегодня: только последние 4 месяца.
  const noHarvest = rows.flatMap((c) => c.blocks.filter((b) => isFreshNoHarvest(b, today)).map((b) => `${b.block} (ц. ${c.cycle})`));
  if (noHarvest.length)
    out.push({
      level: "warn",
      text: `Срок срезки прошёл, записей срезки нет: ${noHarvest.length === 1 ? "блок" : "блоки"} ${noHarvest.slice(0, 5).join(", ")}${noHarvest.length > 5 ? ` и ещё ${noHarvest.length - 5}` : ""}.`,
    });

  // 5. Брак на блоках за неделю против обычной недели (8 недель до неё).
  const weekFrom = shiftDay(today, -6);
  const sumWaste = (from: string, to: string) => data.waste.reduce((s, w) => (w.date >= from && w.date <= to && w.qty > 0 ? s + w.qty : s), 0);
  const wasteWeek = sumWaste(weekFrom, today);
  const wasteBase = sumWaste(shiftDay(weekFrom, -56), shiftDay(weekFrom, -1)) / 8;
  if (wasteWeek >= 300 && wasteBase > 0 && wasteWeek >= wasteBase * 1.8) {
    const top = lossReport(data, weekFrom, today).reasons.find((r) => r.stage === "block");
    out.push({
      level: wasteWeek >= wasteBase * 3 ? "bad" : "warn",
      text: `Брак на блоках за неделю — ${wasteWeek.toLocaleString("ru-RU")} шт., обычно ≈ ${Math.round(wasteBase).toLocaleString("ru-RU")}${top ? `; больше всего — ${top.label.toLowerCase()}` : ""}.`,
      href: { path: "/greenhouse/analytics", params: { view: "losses" } },
    });
  }

  // 6. Брак при срезке и доля высшей/1-й: неделя против 4 недель до неё.
  const base = harvestTotals(data.harvest, shiftDay(weekFrom, -28), shiftDay(weekFrom, -1));
  const week = dash.week;
  if (week.qty >= 3000 && base.qty >= 5000) {
    if (week.rejectPct !== null && base.rejectPct !== null && week.rejectPct - base.rejectPct >= 2 && week.rejectPct >= 3)
      out.push({
        level: "warn",
        text: `Брак при срезке вырос: ${fmt1(week.rejectPct)} % за неделю против ${fmt1(base.rejectPct)} % обычно.`,
        href: { path: "/greenhouse/analytics", params: { view: "losses" } },
      });
    if (week.topPct !== null && base.topPct !== null && base.topPct - week.topPct >= 8)
      out.push({
        level: "warn",
        text: `Высшей и 1-й меньше обычного: ${Math.round(week.topPct)} % за неделю против ${Math.round(base.topPct)} % за месяц до неё.`,
        href: { path: "/greenhouse/analytics", params: { view: "harvest" } },
      });
  }

  // 7. Блок с большим браком на блоке в текущем цикле — выше всех остальных.
  const blockLoss = lossReport(data, shiftDay(today, -29), today).byBlock.filter((b) => b.harvested + b.lost >= 3000 && b.pct !== null);
  if (blockLoss.length >= 3) {
    const pcts = blockLoss.map((b) => b.pct!).sort((a, b) => a - b);
    const med = pcts[Math.floor(pcts.length / 2)];
    const worst = blockLoss[0];
    if (worst.pct! >= Math.max(med * 2, med + 3))
      out.push({
        level: "info",
        text: `${blockLabel(worst.key)}: потери ${fmt1(worst.pct!)} % за 30 дней — заметно выше остальных (обычно ${fmt1(med)} %).`,
        href: { path: "/greenhouse/analytics", params: { view: "losses" } },
      });
  }

  // 8. Прогноз: следующие три недели заметно меньше последних трёх.
  if (forecast && forecast.total > 0) {
    const last21 = data.harvest.reduce((s, h) => (h.date >= shiftDay(today, -20) && h.date <= today && h.qty > 0 ? s + h.qty : s), 0);
    const change = changePct(forecast.total, last21);
    if (last21 > 10000 && change !== null && Math.abs(change) >= 30)
      out.push({
        level: "info",
        text: `По прогнозу следующие 3 недели срежем ≈ ${forecast.total.toLocaleString("ru-RU")} — на ${Math.abs(change)} % ${change > 0 ? "больше" : "меньше"}, чем за прошлые 3.`,
      });
  }

  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, MAX_ALERTS);
}

function isFreshNoHarvest(b: { status: string; expectedHarvestAt: string }, today: string): boolean {
  return b.status === "noharvest" && !!b.expectedHarvestAt && daysBetween(b.expectedHarvestAt, today) <= 120;
}

const fmt1 = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

// --- Отчёт за период ----------------------------------------------------------------------------------------------

export interface ReportRow {
  key: string;
  label: string;
  qty: number;
  saleable: number;
  substandard: number;
  reject: number;
  saleablePct: number | null;
  topPct: number | null;
  avgWeight: number | null;
  /** Брак на блоке за период. */
  waste: number;
  lossPct: number | null;
  /** План агронома на период (только у сортов). */
  plan?: number;
  planPct?: number | null;
}

export interface ReportDay {
  date: string;
  qty: number;
  saleable: number;
  substandard: number;
  reject: number;
  top: number;
  waste: number;
  blocks: number;
}

export interface GreenhouseReport {
  from: string;
  to: string;
  days: number;
  totals: HarvestTotals;
  prev: HarvestTotals;
  loss: LossReport;
  plan: number;
  planPct: number | null;
  byBlock: ReportRow[];
  byVariety: ReportRow[];
  byDay: ReportDay[];
  /** Черенкование за период по видам. */
  cuttings: { kind: string; qty: number }[];
}

/** План агронома на любой отрезок: неделя месяца целиком внутри — вся, на краю — по доле дней. */
export function planForRange(plan: PlanRow[], from: string, to: string): Map<string, { name: string; qty: number }> {
  const out = new Map<string, { name: string; qty: number }>();
  const weekCache = new Map<string, ReturnType<typeof weeksOfMonth>>();
  for (const p of plan) {
    const month = p.period.slice(0, 7);
    if (!weekCache.has(month)) weekCache.set(month, weeksOfMonth(month));
    const w = weekCache.get(month)!.find((x) => x.code === p.period);
    if (!w || w.to < from || w.from > to || p.targetStems <= 0) continue;
    const a = w.from > from ? w.from : from;
    const b = w.to < to ? w.to : to;
    const share = (daysBetween(a, b) + 1) / w.days;
    const k = p.variety.trim().toLowerCase();
    const x = out.get(k) ?? { name: p.variety.trim(), qty: 0 };
    x.qty += p.targetStems * share;
    out.set(k, x);
  }
  return out;
}

const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a * 1000) / b) / 10 : null);

export function buildReport(data: GhInputData, plan: PlanRow[], from: string, to: string): GreenhouseReport {
  const inRange = (d: string) => d >= from && d <= to;
  const prev = previousRange(from, to);
  type Acc = { qty: number; saleable: number; substandard: number; reject: number; top: number; kg: number; kgQty: number; waste: number };
  const blank = (): Acc => ({ qty: 0, saleable: 0, substandard: 0, reject: 0, top: 0, kg: 0, kgQty: 0, waste: 0 });
  const blocks = new Map<string, Acc>();
  const varieties = new Map<string, Acc & { name: string }>();
  const days = new Map<string, ReportDay & { blockSet: Set<string> }>();
  const day = (d: string) => {
    let x = days.get(d);
    if (!x) {
      x = { date: d, qty: 0, saleable: 0, substandard: 0, reject: 0, top: 0, waste: 0, blocks: 0, blockSet: new Set() };
      days.set(d, x);
    }
    return x;
  };
  const addTo = (a: Acc, h: GhHarvest) => {
    a.qty += h.qty;
    const c = saleClass(h.grade);
    a[c] += h.qty;
    if (TOP_GRADES.includes(h.grade)) a.top += h.qty;
    if (h.weightKg > 0) {
      const g = (h.weightKg * 1000) / h.qty;
      if (g >= 10 && g <= 400) {
        a.kg += h.weightKg;
        a.kgQty += h.qty;
      }
    }
  };
  for (const h of data.harvest) {
    if (!inRange(h.date) || h.qty <= 0) continue;
    const b = blocks.get(h.block) ?? blank();
    addTo(b, h);
    blocks.set(h.block, b);
    const vk = (h.variety || "—").trim().toLowerCase();
    const v = varieties.get(vk) ?? { ...blank(), name: h.variety || "—" };
    addTo(v, h);
    varieties.set(vk, v);
    const d = day(h.date);
    d.qty += h.qty;
    d[saleClass(h.grade)] += h.qty;
    if (TOP_GRADES.includes(h.grade)) d.top += h.qty;
    d.blockSet.add(h.block);
  }
  for (const w of data.waste) {
    if (!inRange(w.date) || w.qty <= 0) continue;
    const b = blocks.get(w.block) ?? blank();
    b.waste += w.qty;
    blocks.set(w.block, b);
    const vk = (w.variety || "—").trim().toLowerCase();
    const v = varieties.get(vk) ?? { ...blank(), name: w.variety || "—" };
    v.waste += w.qty;
    varieties.set(vk, v);
    day(w.date).waste += w.qty;
  }
  const row = (key: string, label: string, a: Acc): ReportRow => ({
    key,
    label,
    qty: a.qty,
    saleable: a.saleable,
    substandard: a.substandard,
    reject: a.reject,
    saleablePct: pct1(a.saleable, a.qty),
    topPct: pct1(a.top, a.qty),
    avgWeight: a.kgQty ? Math.round((a.kg * 1000) / a.kgQty) : null,
    waste: a.waste,
    lossPct: pct1(a.reject + a.waste, a.qty + a.waste),
  });
  const planMap = planForRange(plan, from, to);
  const byVariety = Array.from(varieties.entries()).map(([k, v]) => {
    const r = row(k, v.name, v);
    const pl = planMap.get(k);
    if (pl) {
      r.plan = Math.round(pl.qty);
      r.planPct = pl.qty > 0 ? Math.round((v.qty * 100) / pl.qty) : null;
    }
    return r;
  });
  // Сорта, которые были в плане, но не резались.
  for (const [k, pl] of planMap) if (!varieties.has(k) && pl.qty >= 1) byVariety.push({ ...row(k, pl.name, blank()), plan: Math.round(pl.qty), planPct: 0 });
  const planTotal = Math.round(Array.from(planMap.values()).reduce((s, x) => s + x.qty, 0));
  const totals = harvestTotals(data.harvest, from, to);
  const cuttings = new Map<string, number>();
  for (const c of data.cuttings) if (inRange(c.date) && c.qty > 0) cuttings.set(c.kind, (cuttings.get(c.kind) ?? 0) + c.qty);
  return {
    from,
    to,
    days: daysBetween(from, to) + 1,
    totals,
    prev: harvestTotals(data.harvest, prev.from, prev.to),
    loss: lossReport(data, from, to),
    plan: planTotal,
    planPct: planTotal > 0 ? Math.round((totals.qty * 100) / planTotal) : null,
    byBlock: Array.from(blocks.entries())
      .map(([k, a]) => row(k, blockLabel(k), a))
      .sort((a, b) => compareBlocks(a.key, b.key)),
    byVariety: byVariety.sort((a, b) => b.qty - a.qty || (b.plan ?? 0) - (a.plan ?? 0)),
    byDay: Array.from(days.values())
      .map(({ blockSet, ...d }) => ({ ...d, blocks: blockSet.size }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    cuttings: Array.from(cuttings.entries())
      .map(([kind, qty]) => ({ kind, qty }))
      .sort((a, b) => b.qty - a.qty),
  };
}

// --- Сводка данных для вопроса ИИ ---------------------------------------------------------------------------------

/**
 * Короткая выжимка настоящих цифр — всё, что модель знает о теплице. Ответ строится только из неё; чего в ней нет,
 * модель так и говорит (ТЗ: «AI должен использовать реальные данные системы, а не придумывать показатели»).
 */
export function dataDigest(args: {
  farmLabel: string;
  dash: Dashboard;
  rows: CycleRow[];
  report30: GreenhouseReport;
  forecast: Forecast | null;
  accuracy: ForecastAccuracy | null;
  monthsLoss: { month: string; harvested: number; lost: number; pct: number | null }[];
  monthsHarvest: { month: string; qty: number; topPct: number | null }[];
}): string {
  const { dash, rows, report30, forecast, accuracy } = args;
  const n = (x: number) => Math.round(x).toLocaleString("ru-RU");
  const p = (x: number | null) => (x === null ? "нет данных" : `${x.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);
  const lines: string[] = [];
  lines.push(`Теплица: ${args.farmLabel}, хризантема. Сегодня ${dash.today}. Последняя внесённая срезка: ${dash.lastDay || "нет"}.`);
  lines.push(`Срезано: сегодня ${n(dash.todayTotals.qty)}; за 7 дней ${n(dash.week.qty)} (7 дней до этого ${n(dash.prevWeek.qty)}); с начала месяца ${n(dash.month.qty)}; за 30 дней ${n(dash.last30.qty)} (30 дней до этого ${n(dash.prev30.qty)}).`);
  lines.push(`За 30 дней: товарные ${p(dash.last30.saleablePct)}, брак при срезке ${p(dash.last30.rejectPct)}, высшая и первая ${p(dash.last30.topPct)}, средний вес стебля ${dash.last30.avgWeight ?? "нет"} г, в среднем ${n(dash.last30.perDay ?? 0)} в день срезки.`);
  lines.push(`Потери за 30 дней (брак на блоках + брак при срезке): ${n(dash.loss30.lost)} шт., ${p(dash.loss30.lossPct)} (30 дней до этого ${p(dash.lossPrev30.lossPct)}). Причины: ${dash.loss30.reasons.filter((r) => r.stage !== "planting").slice(0, 6).map((r) => `${r.label} ${n(r.qty)}`).join(", ") || "нет"}.`);
  lines.push(`Отход при посадке за 30 дней: ${n(dash.loss30.culls)} из ${n(dash.loss30.arrived)} черенков (${p(dash.loss30.cullPct)}).`);
  lines.push(
    dash.plan.hasPlan
      ? `План срезки агронома на ${dash.plan.month}: ${n(dash.plan.plan)}, к сегодня по плану ${n(dash.plan.planToDate)}, срезано ${n(dash.plan.fact)} (${dash.plan.pacePct ?? "—"} % от плана к сегодня).`
      : `План срезки агронома на ${dash.plan.month} не загружен.`,
  );
  lines.push(`В производстве: ${dash.inField.blocks} блоков растут или режутся, посажено ${n(dash.inField.planted)}, срезано с них ${n(dash.inField.harvested)}, на блоках ещё ≈ ${n(dash.inField.onBeds)}.`);
  if (forecast) {
    lines.push(`Прогноз срезки на 3 недели (${forecast.from} — ${forecast.to}): ${forecast.weeks.map((w) => `${w.label}: ${n(w.qty)}`).join("; ")}; всего ≈ ${n(forecast.total)}${accuracy?.medianError != null ? `, на прошлом такой прогноз ошибался в среднем на ${accuracy.medianError} %` : ""}.`);
    lines.push(`Блоки в прогнозе: ${forecast.blocks.slice(0, 8).map((b) => `блок ${b.block} (ц. ${b.cycle}, ${b.startIsActual ? "режется" : `начало ≈ ${b.start}`}) ≈ ${n(b.inHorizon)}`).join("; ")}.`);
  }
  lines.push(`Блоки за 30 дней (срезано, товарные %, высшая+1-я %, потери %): ${report30.byBlock.map((b) => `${b.label}: ${n(b.qty)}, ${p(b.saleablePct)}, ${p(b.topPct)}, ${p(b.lossPct)}`).join("; ") || "нет"}.`);
  lines.push(`Сорта за 30 дней (срезано, высшая+1-я %, план): ${report30.byVariety.slice(0, 12).map((v) => `${v.label}: ${n(v.qty)}, ${p(v.topPct)}${v.plan ? `, план ${n(v.plan)}` : ""}`).join("; ") || "нет"}.`);
  const maxCycle = Math.max(0, ...rows.map((c) => c.cycle));
  const live = (c: CycleRow, b: CycleRow["blocks"][number]) =>
    b.status === "noharvest" ? isFreshNoHarvest(b, dash.today) : b.status !== "done" && b.status !== "empty" && c.cycle >= maxCycle - 2;
  const statuses = rows.flatMap((c) => c.blocks.filter((b) => live(c, b)).map((b) => `ц.${c.cycle} блок ${b.block}: ${b.status}${b.firstHarvestAt ? `, режется с ${b.firstHarvestAt}` : b.expectedHarvestAt ? `, срезка ожидается ${b.expectedHarvestAt}` : ""}`));
  lines.push(`Блоки сейчас (status: growing — растёт, harvest — режется, noharvest — срок прошёл, срезки нет, cuttings — черенкование): ${statuses.join("; ") || "нет"}.`);
  const finished = rows
    .map((c) => {
      const done = c.blocks.filter((b) => b.status === "done");
      const planted = done.reduce((s, b) => s + b.totals.planted, 0);
      const harvested = done.reduce((s, b) => s + b.totals.harvested, 0);
      return { cycle: c.cycle, planted, harvested };
    })
    .filter((c) => c.planted > 0 && c.harvested > 0)
    .sort((a, b) => a.cycle - b.cycle)
    .slice(-6);
  if (finished.length) lines.push(`Выход завершённых блоков по циклам: ${finished.map((c) => `цикл ${c.cycle}: ${Math.round((c.harvested * 100) / c.planted)} % (срезано ${n(c.harvested)} из ${n(c.planted)})`).join("; ")}.`);
  lines.push(`Срезка по месяцам: ${args.monthsHarvest.map((m) => `${m.month}: ${n(m.qty)}${m.topPct !== null ? ` (высш.+1-я ${Math.round(m.topPct)} %)` : ""}`).join("; ")}.`);
  lines.push(`Потери по месяцам: ${args.monthsLoss.map((m) => `${m.month}: ${p(m.pct)}`).join("; ")}.`);
  return lines.join("\n");
}

export function harvestByMonth(harvest: GhHarvest[], to: string, months = 12): { month: string; qty: number; topPct: number | null }[] {
  const out: { month: string; qty: number; topPct: number | null }[] = [];
  let [y, m] = to.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < months; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const t = harvestTotals(harvest, `${key}-01`, `${key}-31`);
    out.unshift({ month: key, qty: t.qty, topPct: t.topPct });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
