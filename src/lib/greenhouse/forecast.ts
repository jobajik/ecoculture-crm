import { shiftDay } from "../payroll/work";
import { weeksOfMonth } from "../constants";
import { daysBetween } from "./insights";
import { summarizeCycles, type BlockStatus, type CycleRow, type GhCutting, type GhCycle, type GhHarvest, type GhWaste } from "./production";

/**
 * Прогноз срезки и план против факта (30.10.2026, ТЗ владельца: «прогнозирование объёмов сбора на основе исторических
 * данных», «план по дням, неделям, месяцам… процент выполнения, отклонения»). Чистые функции.
 *
 * ПРОГНОЗ строится только из истории самой теплицы, без выдуманных коэффициентов:
 *  - сколько даст блок — посажено × обычный выход ЭТОГО блока в завершённых циклах (нет истории — медиана по теплице);
 *  - когда — с первой срезки блока, а если ещё не режется — с плана срезки из «Данных по датам», иначе посадка +
 *    обычный для теплицы срок от посадки до первой срезки;
 *  - как по дням — «кривая срезки»: какую долю урожая блок обычно отдаёт на 1-й, 2-й, … день от первой срезки,
 *    средняя по завершённым блокам. У блока, который уже режется, остаток раскладывается по оставшейся части кривой.
 *  - итог смешивается пополам с ТЕМПОМ последних трёх недель (срезано за 21 день): по истории самой теплицы
 *    (проверка на прошлом — `forecastAccuracy`, каждые 7 дней с марта 2025) поблочная модель ошибается на 3 недели
 *    в среднем на 30 %, темп — тоже на 30 %, а их среднее — на 21 %. Модель знает, какой блок скоро пойдёт, темп —
 *    сколько реально успевают срезать; ошибаются они в разные стороны.
 * Прогноз — ожидание, а не обещание; на экране так и подписано, рядом — на чём он основан и как ошибался раньше.
 *
 * ПЛАН — это план срезки агронома из «Прогноза срезки» (вкладка HarvestForecast: неделя × сорт). Вторую дверь для
 * плана здесь не открываем (тот же принцип, что у прогноза в CRM: файл и ручная правка разъезжаются), отсюда — только
 * ссылка туда.
 */

const MAX_CURVE_DAYS = 120;
const YIELD_MIN = 20;
const YIELD_MAX = 102;

export interface HarvestCurve {
  /** Доля урожая блока на день от первой срезки (0 — день первой срезки), сумма = 1. */
  daily: number[];
  /** Блоков, по которым построена. */
  blocks: number;
  /** Медиана выхода по завершённым блокам, %. */
  medianYield: number | null;
  /** Медиана дней от посадки до первой срезки. */
  lagDays: number | null;
  /** Медиана выхода по названию блока. */
  yieldByBlock: Record<string, number>;
  /** Сколько дней обычно режется блок (95 % урожая). */
  spanDays: number | null;
  /** Медиана опоздания первой срезки от плана из «Данных по датам», дней (по книге — обычно режут позже плана). */
  planDelay: number | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Кривая срезки и нормы теплицы — по блокам, которые уже отрезали (статус «завершён»). */
export function harvestCurve(rows: CycleRow[], before?: string): HarvestCurve {
  const sums = new Array(MAX_CURVE_DAYS).fill(0);
  let blocks = 0;
  const yields: number[] = [];
  const lags: number[] = [];
  const spans: number[] = [];
  const delays: number[] = [];
  const byBlock = new Map<string, number[]>();
  for (const c of rows) {
    for (const b of c.blocks) {
      if (b.status !== "done" || !b.firstHarvestAt || b.totals.harvested <= 0) continue;
      // Для проверки «прогноз на прошлом» — только то, что закончилось до этой даты.
      if (before && b.lastHarvestAt >= before) continue;
      const total = b.harvestByDay.reduce((s, d) => s + d.qty, 0);
      if (total <= 0) continue;
      let cum = 0;
      let span = 0;
      for (const d of b.harvestByDay) {
        const off = daysBetween(b.firstHarvestAt, d.date);
        if (off < 0 || off >= MAX_CURVE_DAYS) continue;
        sums[off] += d.qty / total;
      }
      for (const d of [...b.harvestByDay].sort((x, y) => x.date.localeCompare(y.date))) {
        cum += d.qty / total;
        if (cum >= 0.95) {
          span = daysBetween(b.firstHarvestAt, d.date) + 1;
          break;
        }
      }
      if (span) spans.push(span);
      blocks += 1;
      const y = b.totals.yieldPct;
      if (y !== null && y >= YIELD_MIN && y <= YIELD_MAX) {
        yields.push(y);
        const list = byBlock.get(b.block) ?? [];
        list.push(y);
        byBlock.set(b.block, list);
      }
      if (b.dates.plannedHarvestAt) {
        const delay = daysBetween(b.dates.plannedHarvestAt, b.firstHarvestAt);
        if (Math.abs(delay) <= 60) delays.push(delay);
      }
      if (b.dates.plantedAt) {
        const lag = daysBetween(b.dates.plantedAt, b.firstHarvestAt);
        if (lag > 20 && lag < 200) lags.push(lag);
      }
    }
  }
  const total = sums.reduce((s, x) => s + x, 0);
  const daily = total > 0 ? sums.map((x) => x / total) : [];
  // Хвост из нулей не нужен.
  while (daily.length && daily[daily.length - 1] === 0) daily.pop();
  const yieldByBlock: Record<string, number> = {};
  for (const [k, v] of byBlock) yieldByBlock[k] = median(v)!;
  return { daily, blocks, medianYield: median(yields), lagDays: median(lags), yieldByBlock, spanDays: median(spans), planDelay: median(delays) };
}

export interface ForecastBlock {
  cycle: number;
  block: string;
  status: BlockStatus;
  planted: number;
  harvested: number;
  /** Сколько блок даст всего (посажено × обычный выход). */
  expectedTotal: number;
  yieldUsed: number;
  /** С какого дня считается кривая (первая срезка или ожидаемая). */
  start: string;
  startIsActual: boolean;
  /** Ожидаем за горизонт прогноза. */
  inHorizon: number;
  byWeek: number[];
}

export interface Forecast {
  from: string;
  to: string;
  days: { date: string; qty: number }[];
  weeks: { from: string; to: string; label: string; qty: number }[];
  blocks: ForecastBlock[];
  varieties: { variety: string; qty: number }[];
  total: number;
  /** Итог только поблочной модели и только темпа — для «на чём основан». */
  modelTotal: number;
  paceTotal: number | null;
  curve: Pick<HarvestCurve, "blocks" | "medianYield" | "lagDays" | "spanDays" | "planDelay">;
}

/** Сколько дней берётся темп. */
export const PACE_DAYS = 21;

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Прогноз срезки на `weeks` недель вперёд с завтрашнего дня (или с `from`). Блоки — «растёт» и «срезка» во всех
 * циклах (блок может дорезать старый цикл, пока растёт новый).
 */
export function forecastHarvest(rows: CycleRow[], today: string, weeks = 3, options: { curve?: HarvestCurve; harvest?: GhHarvest[] } = {}): Forecast {
  const curve = options.curve ?? harvestCurve(rows);
  const from = shiftDay(today, 1);
  const horizon = weeks * 7;
  const to = shiftDay(today, horizon);
  const days = Array.from({ length: horizon }, (_, i) => ({ date: shiftDay(from, i), qty: 0 }));
  const weekList = Array.from({ length: weeks }, (_, i) => {
    const f = shiftDay(from, i * 7);
    const t = shiftDay(f, 6);
    return { from: f, to: t, label: `${dm(f)} – ${dm(t)}`, qty: 0 };
  });
  const varieties = new Map<string, number>();
  const out: ForecastBlock[] = [];
  const cum = (off: number) => {
    if (off < 0) return 0;
    let s = 0;
    for (let i = 0; i <= off && i < curve.daily.length; i++) s += curve.daily[i];
    return s;
  };

  if (curve.daily.length) {
    for (const c of rows) {
      for (const b of c.blocks) {
        if (b.status !== "harvest" && b.status !== "growing") continue;
        const planted = b.totals.planted;
        if (planted <= 0) continue;
        const yieldUsed = curve.yieldByBlock[b.block] ?? curve.medianYield;
        if (!yieldUsed) continue;
        const startIsActual = !!b.firstHarvestAt;
        let start =
          b.firstHarvestAt ||
          (b.dates.plannedHarvestAt ? shiftDay(b.dates.plannedHarvestAt, Math.round(curve.planDelay ?? 0)) : "") ||
          (b.dates.plantedAt && curve.lagDays ? shiftDay(b.dates.plantedAt, Math.round(curve.lagDays)) : b.expectedHarvestAt);
        if (!start) continue;
        // Ожидаемый день прошёл, а срезки нет — блок опаздывает: кривая начинается завтра, а не теряет первые дни.
        if (!startIsActual && start <= today) start = shiftDay(today, 1);
        const expectedTotal = Math.round((planted * yieldUsed) / 100);
        const harvested = b.totals.harvested;
        const remaining = Math.max(0, expectedTotal - harvested);
        const offToday = daysBetween(start, today);
        const left = 1 - cum(offToday);
        const byWeek = new Array(weeks).fill(0);
        let inHorizon = 0;
        if (remaining > 0 && left > 0.005) {
          for (let i = 0; i < horizon; i++) {
            const off = offToday + 1 + i;
            const share = off >= 0 && off < curve.daily.length ? curve.daily[off] : 0;
            if (!share) continue;
            const q = (remaining * share) / left;
            days[i].qty += q;
            byWeek[Math.floor(i / 7)] += q;
            inHorizon += q;
          }
        }
        if (inHorizon <= 0 && b.status !== "harvest") continue;
        // Сорта — по их доле в посаженном на этом блоке.
        const vPlanted = b.varieties.filter((v) => v.planted > 0);
        const vTotal = vPlanted.reduce((s, v) => s + v.planted, 0);
        for (const v of vPlanted) varieties.set(v.variety, (varieties.get(v.variety) ?? 0) + (inHorizon * v.planted) / (vTotal || 1));
        for (let w = 0; w < weeks; w++) weekList[w].qty += byWeek[w];
        out.push({
          cycle: c.cycle,
          block: b.block,
          status: b.status,
          planted,
          harvested,
          expectedTotal,
          yieldUsed: Math.round(yieldUsed),
          start,
          startIsActual,
          inHorizon: Math.round(inHorizon),
          byWeek: byWeek.map((x) => Math.round(x)),
        });
      }
    }
  }
  const modelTotal = Math.round(days.reduce((s, d) => s + d.qty, 0));
  // Темп последних трёх недель: нет срезки за этот срок (теплица стояла) — темпа нет, остаётся модель.
  let paceTotal: number | null = null;
  if (options.harvest) {
    const since = shiftDay(today, -(PACE_DAYS - 1));
    const recent = options.harvest.reduce((s, h) => (h.date >= since && h.date <= today && h.qty > 0 ? s + h.qty : s), 0);
    if (recent > 0) {
      const perDay = recent / PACE_DAYS;
      paceTotal = Math.round(perDay * horizon);
      for (const d of days) d.qty = (d.qty + perDay) / 2;
      for (const w of weekList) w.qty = (w.qty + perDay * 7) / 2;
      // Сорта — та же доля, что в модели, от смешанного итога.
      const factor = modelTotal > 0 ? (modelTotal + paceTotal) / 2 / modelTotal : 0;
      for (const v of varieties.keys()) varieties.set(v, varieties.get(v)! * factor);
    }
  }
  return {
    from,
    to,
    days: days.map((d) => ({ date: d.date, qty: Math.round(d.qty) })),
    weeks: weekList.map((w) => ({ ...w, qty: Math.round(w.qty) })),
    blocks: out.sort((a, b) => b.inHorizon - a.inHorizon),
    varieties: Array.from(varieties.entries())
      .map(([variety, qty]) => ({ variety, qty: Math.round(qty) }))
      .filter((v) => v.qty > 0)
      .sort((a, b) => b.qty - a.qty),
    total: Math.round(days.reduce((s, d) => s + d.qty, 0)),
    modelTotal,
    paceTotal,
    curve: { blocks: curve.blocks, medianYield: curve.medianYield, lagDays: curve.lagDays, spanDays: curve.spanDays, planDelay: curve.planDelay },
  };
}

// --- План против факта ------------------------------------------------------------------------------------------------

export interface PlanRow {
  /** Неделя месяца «2026-10-W2». */
  period: string;
  variety: string;
  targetStems: number;
}

export interface PlanWeekFact {
  code: string;
  label: string;
  from: string;
  to: string;
  plan: number;
  fact: number;
  pct: number | null;
  /** past — неделя прошла, current — идёт, future — впереди. */
  when: "past" | "current" | "future";
}

export interface PlanFact {
  month: string;
  hasPlan: boolean;
  weeks: PlanWeekFact[];
  plan: number;
  fact: number;
  /** Сколько должно было быть срезано к сегодня по плану (прошедшие недели целиком, текущая — по дням). */
  planToDate: number;
  pct: number | null;
  /** Факт к «должно быть к сегодня», %. */
  pacePct: number | null;
  varieties: { variety: string; plan: number; fact: number; pct: number | null }[];
}

const key = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

export function planFact(plan: PlanRow[], harvest: GhHarvest[], month: string, today: string): PlanFact {
  const weeks = weeksOfMonth(month);
  const monthPlan = plan.filter((p) => p.period.startsWith(`${month}-W`));
  const from = weeks[0]?.from ?? `${month}-01`;
  const to = weeks[weeks.length - 1]?.to ?? `${month}-28`;
  const facts = harvest.filter((h) => h.date >= from && h.date <= to && h.qty > 0);
  let planToDate = 0;
  const weekRows: PlanWeekFact[] = weeks.map((w) => {
    const p = monthPlan.filter((x) => x.period === w.code).reduce((s, x) => s + x.targetStems, 0);
    const f = facts.filter((h) => h.date >= w.from && h.date <= w.to).reduce((s, h) => s + h.qty, 0);
    const when: PlanWeekFact["when"] = today > w.to ? "past" : today >= w.from ? "current" : "future";
    if (when === "past") planToDate += p;
    else if (when === "current") planToDate += (p * (daysBetween(w.from, today) + 1)) / w.days;
    return { code: w.code, label: w.label, from: w.from, to: w.to, plan: p, fact: f, pct: p > 0 ? Math.round((f * 100) / p) : null, when };
  });
  const vPlan = new Map<string, { name: string; plan: number; fact: number }>();
  for (const p of monthPlan) {
    const x = vPlan.get(key(p.variety)) ?? { name: p.variety, plan: 0, fact: 0 };
    x.plan += p.targetStems;
    vPlan.set(key(p.variety), x);
  }
  for (const h of facts) {
    if (!h.variety) continue;
    const x = vPlan.get(key(h.variety)) ?? { name: h.variety, plan: 0, fact: 0 };
    x.fact += h.qty;
    vPlan.set(key(h.variety), x);
  }
  const planTotal = weekRows.reduce((s, w) => s + w.plan, 0);
  const factTotal = weekRows.reduce((s, w) => s + w.fact, 0);
  return {
    month,
    hasPlan: planTotal > 0,
    weeks: weekRows,
    plan: planTotal,
    fact: factTotal,
    planToDate: Math.round(planToDate),
    pct: planTotal > 0 ? Math.round((factTotal * 100) / planTotal) : null,
    pacePct: planToDate > 0 ? Math.round((factTotal * 100) / planToDate) : null,
    varieties: Array.from(vPlan.values())
      .map((v) => ({ variety: v.name, plan: v.plan, fact: v.fact, pct: v.plan > 0 ? Math.round((v.fact * 100) / v.plan) : null }))
      .sort((a, b) => b.plan - a.plan || b.fact - a.fact),
  };
}

// --- Точность прогноза на прошлом ---------------------------------------------------------------------------------------

export interface ForecastAccuracy {
  /** Медиана ошибки прогноза на 3 недели, % от факта. */
  medianError: number | null;
  /** Сколько раз проверили. */
  runs: number;
}

/**
 * «Как бы ошибся прогноз, сделанный тогда»: каждые `stepDays` дней за последний год берём только данные до той даты,
 * строим прогноз на 3 недели и сравниваем с тем, что срезали на самом деле. Число стоит на экране рядом с прогнозом.
 */
export function forecastAccuracy(
  data: { cycles: GhCycle[]; harvest: GhHarvest[]; cuttings: GhCutting[]; waste: GhWaste[] },
  today: string,
  options: { runs?: number; stepDays?: number } = {},
): ForecastAccuracy {
  const runs = options.runs ?? 12;
  const step = options.stepDays ?? 28;
  const errors: number[] = [];
  for (let k = 0; k < runs; k++) {
    const t = shiftDay(today, -(21 + 1 + k * step));
    const cut = {
      cycles: data.cycles,
      harvest: data.harvest.filter((h) => h.date <= t),
      cuttings: data.cuttings.filter((c) => c.date <= t),
      waste: data.waste.filter((w) => w.date <= t),
    };
    const rows = summarizeCycles(cut, t);
    const f = forecastHarvest(rows, t, 3, { curve: harvestCurve(rows, t), harvest: cut.harvest });
    const actual = data.harvest.reduce((s, h) => (h.date >= f.from && h.date <= f.to && h.qty > 0 ? s + h.qty : s), 0);
    if (actual <= 0 || f.total <= 0) continue;
    errors.push(Math.abs(f.total - actual) / actual);
  }
  return { medianError: errors.length ? Math.round((median(errors) ?? 0) * 100) : null, runs: errors.length };
}
